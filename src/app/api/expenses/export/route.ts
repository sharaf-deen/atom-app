// src/app/api/expenses/export/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

type Role = 'member' | 'assistant_coach' | 'coach' | 'reception' | 'admin' | 'super_admin'

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function csvCell(v: unknown) {
  const s = String(v ?? '')
  return `"${s.replace(/"/g, '""')}"`
}

function isISODateOnly(s?: string | null) {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function sanitizeSearch(v: string) {
  return (v || '').replace(/[%,_]/g, ' ').replace(/\s+/g, ' ').trim()
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

function paymentLabel(v?: string | null) {
  if (!v) return '—'
  if (v === 'cash') return 'Cash'
  if (v === 'visa') return 'Visa card'
  if (v === 'instapay') return 'Instapay'
  if (v === 'bank_transfer') return 'Bank transfer'
  return v
}

export async function GET(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) return json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle<{ role: Role | null }>()

    if (meErr) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message })
    if (!['admin', 'super_admin'].includes((me?.role as Role) ?? 'member')) return json(403, { ok: false, error: 'FORBIDDEN' })

    const admin = makeAdminClient()
    if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_MISSING' })

    const { searchParams } = new URL(req.url)
    const from = searchParams.get('from') ?? ''
    const to = searchParams.get('to') ?? ''
    const category = searchParams.get('category') ?? 'all'
    const payment_method = searchParams.get('payment_method') ?? 'all'
    const qRaw = searchParams.get('q') ?? ''
    const qText = sanitizeSearch(qRaw)

    if (!isISODateOnly(from) || !isISODateOnly(to) || from > to) {
      return json(400, { ok: false, error: 'INVALID_RANGE', hint: 'Use ?from=YYYY-MM-DD&to=YYYY-MM-DD with from ≤ to' })
    }

    const allowedMethods = new Set(['all', 'cash', 'visa', 'instapay', 'bank_transfer'])
    if (!allowedMethods.has(payment_method)) {
      return json(400, { ok: false, error: 'INVALID_PAYMENT_METHOD' })
    }

    const { data: cats } = await admin.from('expense_categories').select('key,label').eq('is_active', true)
    const labelByKey = new Map<string, string>()
    for (const c of cats ?? []) labelByKey.set(c.key, c.label)

    let q = admin
      .from('expenses')
      .select('id,date,category_key,description,amount,payment_method,receipt_filename,receipt_path')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false })
      .order('id', { ascending: false })
      .limit(100000)

    if (category && category !== 'all') q = q.eq('category_key', category)
    if (payment_method && payment_method !== 'all') q = q.eq('payment_method', payment_method)
    if (qText) {
      const like = `%${qText}%`
      q = q.or(`description.ilike.${like},category_key.ilike.${like},payment_method.ilike.${like}`)
    }

    const { data: rows, error: qErr } = await q
    if (qErr) return json(500, { ok: false, error: 'QUERY_FAILED', details: qErr.message })

    const breakdown = { cash: 0, visa: 0, instapay: 0, bank_transfer: 0 }
    let total = 0

    const header = ['id', 'date', 'category_key', 'category_label', 'description', 'amount', 'payment_method', 'payment_label', 'receipt_filename', 'receipt_path']
    const lines: string[] = []

    lines.push(['Report from', from, 'to', to].map(csvCell).join(','))
    lines.push(['Category filter', category].map(csvCell).join(','))
    lines.push(['Payment filter', payment_method].map(csvCell).join(','))
    lines.push(['Search', qRaw].map(csvCell).join(','))
    lines.push('')

    for (const r of rows ?? []) {
      const key = r.category_key ?? ''
      const label = key ? labelByKey.get(key) ?? '' : ''
      const amt = Number(r.amount)
      if (Number.isFinite(amt)) {
        total += amt
        const method = String(r.payment_method || 'cash')
        if (method === 'visa') breakdown.visa += amt
        else if (method === 'instapay') breakdown.instapay += amt
        else if (method === 'bank_transfer') breakdown.bank_transfer += amt
        else breakdown.cash += amt
      }

      lines.push([
        r.id,
        r.date,
        key,
        label,
        r.description ?? '',
        r.amount ?? '',
        r.payment_method ?? '',
        paymentLabel(r.payment_method ?? ''),
        r.receipt_filename ?? '',
        r.receipt_path ?? '',
      ].map(csvCell).join(','))
    }

    lines.push('')
    lines.push(['Summary', 'Amount'].map(csvCell).join(','))
    lines.push(['Total', total.toFixed(2)].map(csvCell).join(','))
    lines.push(['Cash', breakdown.cash.toFixed(2)].map(csvCell).join(','))
    lines.push(['Visa card', breakdown.visa.toFixed(2)].map(csvCell).join(','))
    lines.push(['Instapay', breakdown.instapay.toFixed(2)].map(csvCell).join(','))
    lines.push(['Bank transfer', breakdown.bank_transfer.toFixed(2)].map(csvCell).join(','))

    lines.splice(5, 0, header.map(csvCell).join(','))

    const filename = `expenses_${from}_to_${to}.csv`

    return new NextResponse(lines.join('\r\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
