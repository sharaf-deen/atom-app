// src/app/api/admin/payments/export/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { addDaysDateOnly, cairoDayBoundsUTC, isISODateOnly } from '@/lib/cairoTime'

type Role = 'member' | 'assistant_coach' | 'coach' | 'reception' | 'admin' | 'super_admin'

const IMPOSSIBLE_MEMBER_ID = '00000000-0000-0000-0000-000000000000'

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function csvCell(v: unknown) {
  const s = String(v ?? '')
  return `"${s.replace(/"/g, '""')}"`
}

function sanitizeSearch(v: string) {
  return (v || '').replace(/[%,_]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

function paymentLabel(v?: string | null) {
  if (!v) return 'Cash'
  if (v === 'cash') return 'Cash'
  if (v === 'instapay') return 'Instapay'
  if (v === 'card' || v === 'visa') return 'Card'
  if (v === 'bank_transfer') return 'Bank transfer'
  return v
}

function formatCairoDateTime(iso?: string | null) {
  const raw = String(iso ?? '').trim()
  if (!raw) return '—'
  const dt = new Date(raw)
  if (Number.isNaN(dt.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(dt)
}

function applyPaymentMethodFilter<T extends { eq: Function; in: Function }>(query: T, method: string) {
  if (!method || method === 'all') return query
  if (method === 'card') return query.in('payment_method', ['card', 'visa'])
  return query.eq('payment_method', method)
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
    const payment_method = searchParams.get('payment_method') ?? 'all'
    const qRaw = searchParams.get('q') ?? ''
    const qText = sanitizeSearch(qRaw)

    if (!isISODateOnly(from) || !isISODateOnly(to) || from > to) {
      return json(400, { ok: false, error: 'INVALID_RANGE', hint: 'Use ?from=YYYY-MM-DD&to=YYYY-MM-DD with from ≤ to' })
    }

    const allowedMethods = new Set(['all', 'cash', 'instapay', 'card', 'bank_transfer'])
    if (!allowedMethods.has(payment_method)) {
      return json(400, { ok: false, error: 'INVALID_PAYMENT_METHOD' })
    }

    let memberIds: string[] | null = null
    if (qText) {
      const like = `%${qText}%`
      const { data: profs } = await admin
        .from('profiles')
        .select('user_id')
        .or(
          `email.ilike.${like},first_name.ilike.${like},last_name.ilike.${like},phone.ilike.${like},member_id.ilike.${like}`
        )
        .limit(200)

      memberIds = (profs ?? []).map((p: any) => p.user_id).filter(Boolean)
      if (!memberIds.length) memberIds = []
    }

    const startISO = cairoDayBoundsUTC(from).startISO
    const endISO = cairoDayBoundsUTC(addDaysDateOnly(to, 1)).startISO

    let query = admin
      .from('subscription_payments')
      .select(
        'id, subscription_id, member_id, amount, payment_method, note, paid_at, created_at, member:profiles!subscription_payments_member_id_fkey(member_id,email,first_name,last_name,phone), actor:profiles!subscription_payments_created_by_fkey(email,first_name,last_name)'
      )
      .gte('paid_at', startISO)
      .lt('paid_at', endISO)
      .order('paid_at', { ascending: false })
      .limit(100000)

    query = applyPaymentMethodFilter(query as any, payment_method) as any
    if (memberIds) {
      if (!memberIds.length) query = query.in('member_id', [IMPOSSIBLE_MEMBER_ID])
      else query = query.in('member_id', memberIds)
    }

    const { data: rows, error: qErr } = await query
    if (qErr) return json(500, { ok: false, error: 'QUERY_FAILED', details: qErr.message })

    const totals = { all: 0, cash: 0, instapay: 0, card: 0, bank_transfer: 0 }

    const header = [
      'payment_id',
      'subscription_id',
      'paid_at_egypt',
      'recorded_at_egypt',
      'member_id',
      'member_name',
      'member_email',
      'member_phone',
      'amount',
      'payment_method',
      'payment_label',
      'note',
      'recorded_by',
    ]

    const lines: string[] = []
    lines.push(['Report from', from, 'to', to].map(csvCell).join(','))
    lines.push(['Payment filter', payment_method].map(csvCell).join(','))
    lines.push(['Search', qRaw].map(csvCell).join(','))
    lines.push('')
    lines.push(header.map(csvCell).join(','))

    for (const r of (rows ?? []) as any[]) {
      const amount = Number(r.amount ?? 0)
      if (Number.isFinite(amount)) {
        totals.all += amount
        const method = String(r.payment_method ?? 'cash')
        if (method === 'cash') totals.cash += amount
        else if (method === 'instapay') totals.instapay += amount
        else if (method === 'card' || method === 'visa') totals.card += amount
        else if (method === 'bank_transfer') totals.bank_transfer += amount
      }

      const memberName = `${r.member?.first_name ?? ''} ${r.member?.last_name ?? ''}`.trim()
      const actorName = `${r.actor?.first_name ?? ''} ${r.actor?.last_name ?? ''}`.trim() || r.actor?.email || ''

      lines.push(
        [
          r.id,
          r.subscription_id,
          formatCairoDateTime(r.paid_at ?? r.created_at),
          formatCairoDateTime(r.created_at),
          r.member?.member_id ?? '',
          memberName,
          r.member?.email ?? '',
          r.member?.phone ?? '',
          Number.isFinite(amount) ? amount.toFixed(2) : '',
          r.payment_method ?? '',
          paymentLabel(r.payment_method ?? ''),
          r.note ?? '',
          actorName,
        ].map(csvCell).join(',')
      )
    }

    lines.push('')
    lines.push(['Summary', 'Amount'].map(csvCell).join(','))
    lines.push(['Total', totals.all.toFixed(2)].map(csvCell).join(','))
    lines.push(['Cash', totals.cash.toFixed(2)].map(csvCell).join(','))
    lines.push(['Instapay', totals.instapay.toFixed(2)].map(csvCell).join(','))
    lines.push(['Card', totals.card.toFixed(2)].map(csvCell).join(','))
    lines.push(['Bank transfer', totals.bank_transfer.toFixed(2)].map(csvCell).join(','))

    const filename = `payments_${from}_to_${to}.csv`

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
