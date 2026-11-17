export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

type CardTransaction = {
  row: number
  date: string
  settlement_date: string
  amount_cents: number
  approval_code: string
  batch: string
}
type PaymentCandidate = {
  source: 'subscription' | 'store' | 'other_income'
  id: string
  date: string
  amount_cents: number
  note: string
}
type Match = { transaction: CardTransaction; status: 'reference_candidate' | 'single_candidate' | 'ambiguous' | 'unmatched'; candidates: Array<{source: string; id: string; date: string; amount: number; evidence: string}> }

function json(value: unknown, status = 200) {
  const response = NextResponse.json(value, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function csvRows(text: string): string[][] {
  const out: string[][] = []
  let quoted = false, cell = '', row: string[] = []
  const value = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < value.length; i++) {
    const c = value[i]
    if (c === '"') {
      if (quoted && value[i + 1] === '"') { cell += '"'; i++ }
      else quoted = !quoted
    } else if (c === ',' && !quoted) {
      row.push(cell); cell = ''
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && value[i + 1] === '\n') i++
      row.push(cell)
      if (row.some(v => v.trim())) out.push(row)
      row = []; cell = ''
    } else cell += c
  }
  if (quoted) throw new Error('Unclosed CSV quote')
  row.push(cell)
  if (row.some(v => v.trim())) out.push(row)
  return out
}

function day(raw: string): string {
  const s = raw.trim()
  if (/^\d{5}$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000).toISOString().slice(0, 10)
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s)
  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s)
  const candidate = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : null
  if (!candidate) throw new Error('Invalid transaction date')
  const date = candidate[0] + '-' + candidate[1].padStart(2,'0') + '-' + candidate[2].padStart(2,'0')
  if (new Date(date + 'T00:00:00Z').toISOString().slice(0,10) !== date) throw new Error('Invalid calendar date')
  return date
}

function cents(input: string): number {
  const raw = input.replace(/,/g, '').trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error('Invalid positive amount')
  return Math.round(Number(raw) * 100)
}

function localCairoDay(value: string): string {
  const timestamp = new Date(value)
  if (!Number.isFinite(timestamp.getTime())) throw new Error('Invalid ATOM payment date')
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(timestamp)
  const get = (part: string) => parts.find(item => item.type === part)?.value ?? ''
  return get('year') + '-' + get('month') + '-' + get('day')
}

function dayDistance(a: string, b: string) {
  return Math.abs((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000)
}

function asString(value: unknown) { return String(value ?? '') }
function safeNote(value: unknown) { return asString(value).slice(0, 1000) }

function candidateList(transaction: CardTransaction, payments: PaymentCandidate[]) {
  const possible = payments
    .filter(p => p.amount_cents === transaction.amount_cents && dayDistance(p.date, transaction.date) <= 1)
    .map(p => ({
      source: p.source,
      id: p.id,
      date: p.date,
      amount: p.amount_cents / 100,
      evidence: transaction.approval_code && p.note.toUpperCase().includes(transaction.approval_code.toUpperCase())
        ? 'reference + exact gross amount + date'
        : p.date === transaction.date ? 'exact gross amount + same date ONLY' : 'exact gross amount + adjacent date ONLY',
    }))
  // Approval-code matches have stronger supporting evidence. Amount/date alone never proves a match.
  possible.sort((a, b) => Number(b.evidence.startsWith('reference')) - Number(a.evidence.startsWith('reference')))
  const strong = possible.filter(p => p.evidence.startsWith('reference'))
  const status: Match['status'] = strong.length === 1 && possible.length === 1 ? 'reference_candidate'
    : possible.length === 1 ? 'single_candidate'
    : possible.length > 1 ? 'ambiguous' : 'unmatched'
  return { transaction, status, candidates: possible.slice(0, 15) }
}

type GroupCandidate = {
  payments: Array<{source: string; id: string; date: string; amount: number}>
  total: number
  evidence: string
  conflicts_with_other_cib_rows: boolean
}
type GroupPreview = {row: number; groups: GroupCandidate[]; truncated: boolean}

// Deliberately bounded search: group sizes 2–4, at most 40 nearby card records,
// 12 displayed combinations. A cap is reported, never mistaken for no match.
function groupedCandidates(transaction: CardTransaction, payments: PaymentCandidate[]): GroupPreview {
  const nearby = payments.filter(p => p.amount_cents > 0 && p.amount_cents < transaction.amount_cents
    && dayDistance(p.date, transaction.date) <= 1)
    .sort((a,b) => dayDistance(a.date,transaction.date) - dayDistance(b.date,transaction.date)
      || b.amount_cents-a.amount_cents || a.id.localeCompare(b.id))
  const limited = nearby.slice(0,40)
  const groups: GroupCandidate[] = []
  let truncated = nearby.length > 40
  let iterations = 0
  const chosen: PaymentCandidate[] = []
  function walk(start: number, remaining: number) {
    if (groups.length >= 12 || iterations >= 80000) { truncated = true; return }
    if (remaining === 0) {
      if (chosen.length >= 2) groups.push({
        payments: chosen.map(p=>({source:p.source,id:p.id,date:p.date,amount:p.amount_cents/100})),
        total:transaction.amount_cents/100,
        evidence:'Exact sum of '+chosen.length+' card payments within ±1 day; no receipt reference verified',
        conflicts_with_other_cib_rows:false,
      })
      return
    }
    if (chosen.length >= 4) return
    for (let index=start;index<limited.length;index++) {
      iterations++
      if (groups.length >= 12 || iterations >= 80000) {truncated=true;break}
      const item=limited[index]
      if (item.amount_cents > remaining) continue
      chosen.push(item)
      walk(index+1,remaining-item.amount_cents)
      chosen.pop()
    }
  }
  walk(0,transaction.amount_cents)
  return {row:transaction.row,groups,truncated}
}

export async function POST(request: Request) {
  const me = await getSessionUser()
  if (!me) return json({ok:false,error:'NOT_AUTHENTICATED'},401)
  if (me.role !== 'super_admin') return json({ok:false,error:'FORBIDDEN'},403)

  try {
    const data = await request.formData()
    const file = data.get('transactions')
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.csv') || file.size > 2_000_000)
      return json({ok:false,error:'CIB_TRANSACTIONS_CSV_REQUIRED_MAX_2MB'},400)
    const matrix = csvRows(await file.text())
    if (matrix.length < 2 || matrix.length > 10001) throw new Error('Invalid CIB CSV size')
    const headers = matrix[0].map(h => h.toLowerCase().trim())
    const required = ['terminalid','batchno','transactiondate','settlementdate','transactionamount','approvalcode','accountnumber']
    for (const h of required) if (!headers.includes(h)) throw new Error('Missing CIB column: ' + h)
    const seen = new Set<string>()
    const transactions: CardTransaction[] = matrix.slice(1).map((cells, i) => {
      if (cells.length !== headers.length) throw new Error('CIB row column mismatch: ' + (i + 2))
      const val = (key: string) => (cells[headers.indexOf(key)] ?? '').trim()
      const terminal = val('terminalid'), batch = val('batchno')
      const allowed = terminal === '28276801' && /^28276801[_M]/.test(batch)
        || terminal === '282768' && /^28276801M[0-9]+$/.test(batch)
      if (!allowed || val('accountnumber') !== '100075806935') throw new Error('Unexpected merchant account/terminal/batch at row ' + (i + 2))
      const t: CardTransaction = {
        row: i + 2, date: day(val('transactiondate')),
        settlement_date: day(val('settlementdate')), amount_cents: cents(val('transactionamount')),
        approval_code: val('approvalcode').replace(/[^0-9a-z]/gi, '').slice(0, 20),
        batch,
      }
      const key = [batch, t.date, t.amount_cents, t.approval_code, val('cardnumber')].join('|')
      if (seen.has(key)) throw new Error('Duplicate row detected in CIB report')
      seen.add(key)
      return t
    })
    const first = transactions.map(t=>t.date).sort()[0]
    const last = transactions.map(t=>t.date).sort().slice(-1)[0]
    if (dayDistance(first,last) > 62) throw new Error('Please upload a report covering at most 63 days')
    const dateFrom = new Date(Date.parse(first + 'T00:00:00Z') - 2 * 86400000).toISOString().slice(0,10)
    const dateTo = new Date(Date.parse(last + 'T00:00:00Z') + 3 * 86400000).toISOString().slice(0,10)
    const admin = createSupabaseAdminClient()
    const [subs,store,other] = await Promise.all([
      admin.from('subscription_payments')
        .select('id,amount,paid_at,note,payment_method')
        .eq('payment_method','card').gte('paid_at',dateFrom+'T00:00:00Z').lt('paid_at',dateTo+'T00:00:00Z').limit(5000),
      admin.from('store_sales')
        .select('id,paid_cents,purchase_date,note,status,payment_method')
        .eq('payment_method','card').gte('purchase_date',dateFrom).lte('purchase_date',dateTo).limit(5000),
      admin.from('external_income_entries')
        .select('id,amount,entry_date,note,payment_method')
        .eq('payment_method','card').gte('entry_date',dateFrom).lte('entry_date',dateTo).limit(5000),
    ])
    if (subs.error || store.error || other.error) throw new Error('ATOM payments lookup failed')
    if ([subs.data,store.data,other.data].some(rows => (rows?.length ?? 0) >= 5000)) throw new Error('Too many ATOM payments; narrow the CIB date range')
    const candidates: PaymentCandidate[] = [
      ...(subs.data ?? []).map((p: any)=>({
        source:'subscription' as const,id:asString(p.id),date:localCairoDay(asString(p.paid_at)),
        amount_cents:Math.round(Number(p.amount)*100),note:safeNote(p.note),
      })),
      ...(store.data ?? []).filter((p:any) => Number(p.paid_cents)>0).map((p: any)=>({
        source:'store' as const,id:asString(p.id),date:asString(p.purchase_date),
        amount_cents:Number(p.paid_cents),note:safeNote(p.note),
      })),
      ...(other.data ?? []).map((p:any)=>({
        source:'other_income' as const,id:asString(p.id),date:asString(p.entry_date),
        amount_cents:Math.round(Number(p.amount)*100),note:safeNote(p.note),
      })),
    ]
    const matches = transactions.map(t=>candidateList(t,candidates))
    // One ATOM payment cannot establish two separate CIB payments:
    // repeated use makes both candidate lists ambiguous until manually resolved.
    const usage = new Map<string,number>()
    for (const match of matches) {
      for (const candidate of match.candidates) {
        const key = candidate.source + ':' + candidate.id
        usage.set(key, (usage.get(key) ?? 0) + 1)
      }
    }
    for (const match of matches) {
      if (match.candidates.some(candidate => (usage.get(candidate.source+':'+candidate.id) ?? 0)>1))
        match.status = 'ambiguous'
    }
    // Grouped suggestions are independent of individual match status. Any record used
    // by multiple plausible CIB rows is explicitly flagged, never auto-allocated.
    const grouped = matches.map(m=>groupedCandidates(m.transaction,candidates))
    const byPayment = new Map<string,Set<number>>()
    for (const match of matches) {
      for (const candidate of match.candidates) {
        const key=candidate.source+':'+candidate.id
        if (!byPayment.has(key)) byPayment.set(key,new Set())
        byPayment.get(key)!.add(match.transaction.row)
      }
    }
    for (const groupPreview of grouped) for (const group of groupPreview.groups)
      for (const p of group.payments) {
        const key=p.source+':'+p.id
        if (!byPayment.has(key)) byPayment.set(key,new Set())
        byPayment.get(key)!.add(groupPreview.row)
      }
    for (const groupPreview of grouped) for (const group of groupPreview.groups)
      group.conflicts_with_other_cib_rows=group.payments.some(p=>
        (byPayment.get(p.source+':'+p.id)?.size ?? 0)>1)
    const groupedSummary = {
      rows_with_group_candidates:grouped.filter(g=>g.groups.length>0).length,
      rows_search_truncated:grouped.filter(g=>g.truncated).length,
      group_combinations:grouped.reduce((s,g)=>s+g.groups.length,0),
    }
    const aggregate = {
      reference_candidate:matches.filter(x=>x.status==='reference_candidate').length,
      single_candidate:matches.filter(x=>x.status==='single_candidate').length,
      ambiguous:matches.filter(x=>x.status==='ambiguous').length,
      unmatched:matches.filter(x=>x.status==='unmatched').length,
    }
    return json({
      ok:true,read_only:true,
      totals:{ cib_transactions:transactions.length, cib_gross:transactions.reduce((s,t)=>s+t.amount_cents,0)/100,
        atom_card_records:candidates.length, atom_card_gross:candidates.reduce((s,p)=>s+p.amount_cents,0)/100 },
      aggregate,matches,grouped,groupedSummary,
      warning:'These are candidate links only, including grouped sums. Exact amount and date do not prove ownership. Group suggestions can overlap other CIB transactions. No payment, allocation, or reconciliation was confirmed.',
    })
  } catch(error) {
    return json({ok:false,error:'CIB_PAYMENT_PREVIEW_FAILED',details:error instanceof Error?error.message:'Unknown error'},400)
  }
}
