// src/app/api/expenses/export/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { expensePaymentLabel, parseExpenseFilters, sanitizeExpenseSearch } from '@/lib/expenseFilters'

type Role = 'member' | 'assistant_coach' | 'coach' | 'reception' | 'admin' | 'super_admin'

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function csvCell(v: any) {
  const s = v === null || v === undefined ? '' : String(v)
  return `"${s.replace(/"/g, '""')}"`
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
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

    const role: Role = (me?.role as Role) ?? 'member'
    if (!['admin', 'super_admin'].includes(role)) return json(403, { ok: false, error: 'FORBIDDEN' })

    const admin = makeAdminClient()
    if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_MISSING' })

    const url = new URL(req.url)
    const filters = parseExpenseFilters(Object.fromEntries(url.searchParams.entries()))
    const { from, to, category, payment_method, qRaw } = filters
    const qText = sanitizeExpenseSearch(qRaw)

    const allowedMethods = new Set(['all', 'cash', 'visa', 'instapay', 'bank_transfer'])
    if (!allowedMethods.has(payment_method)) {
      return json(400, { ok: false, error: 'INVALID_PAYMENT_METHOD' })
    }

    const { data: cats } = await admin.from('expense_categories').select('key,label').eq('is_active', true)
    const labelByKey = new Map<string, string>()
    for (const c of cats ?? []) labelByKey.set(c.key, c.label)

    let query = admin
      .from('expenses')
      .select('id,date,category_key,description,amount,payment_method,receipt_filename,receipt_path')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false })
      .order('id', { ascending: false })
      .limit(100000)

    if (category && category !== 'all') query = query.eq('category_key', category)
    if (payment_method && payment_method !== 'all') query = query.eq('payment_method', payment_method)

    if (qText) {
      const like = `%${qText}%`
      query = query.or(`description.ilike.${like},category_key.ilike.${like},payment_method.ilike.${like}`)
    }

    const { data: rows, error: qErr } = await query
    if (qErr) return json(500, { ok: false, error: 'QUERY_FAILED', details: qErr.message })

    const header = [
      'id',
      'date',
      'category_key',
      'category_label',
      'description',
      'amount',
      'payment_method',
      'payment_label',
      'receipt_filename',
      'receipt_path',
    ]

    const lines: string[] = [header.map(csvCell).join(',')]
    let total = 0

    for (const r of rows ?? []) {
      const key = r.category_key ?? ''
      const label = key ? labelByKey.get(key) ?? '' : ''
      const amt = Number(r.amount)
      if (Number.isFinite(amt)) total += amt

      lines.push(
        [
          r.id,
          r.date,
          key,
          label,
          r.description ?? '',
          r.amount ?? '',
          r.payment_method ?? '',
          expensePaymentLabel(String(r.payment_method ?? 'all')),
          r.receipt_filename ?? '',
          r.receipt_path ?? '',
        ].map(csvCell).join(',')
      )
    }

    lines.push(['TOTAL', '', '', '', '', total.toFixed(2), '', '', '', ''].map(csvCell).join(','))

    const filenameBits = [
      `expenses_${from}_to_${to}`,
      category && category !== 'all' ? category : '',
      payment_method && payment_method !== 'all' ? payment_method : '',
      qText ? 'search' : '',
    ].filter(Boolean)

    return new NextResponse(lines.join('\r\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filenameBits.join('_')}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
