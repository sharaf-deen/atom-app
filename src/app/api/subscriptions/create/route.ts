// src/app/api/subscriptions/create/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { generateInvoicePdfBytes, makeInvoiceNumber, type InvoiceSnapshot } from '@/lib/invoices'

type Plan = '1m' | '3m' | '6m' | '12m' | 'sessions'

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function isPlan(v: unknown): v is Plan {
  return v === '1m' || v === '3m' || v === '6m' || v === '12m' || v === 'sessions'
}

function isISODateOnly(s?: string | null) {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function dateOnlyUTC(d = new Date()) {
  return d.toISOString().slice(0, 10) // YYYY-MM-DD (UTC)
}

function addDays(dateOnlyStr: string, days: number) {
  const [y, m, d] = dateOnlyStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

// addMonths "safe": clamp to last day of target month if needed (handles 31st)
function addMonthsSafe(dateOnlyStr: string, months: number) {
  const [y, m, d] = dateOnlyStr.split('-').map(Number)

  const base = new Date(Date.UTC(y, m - 1, d))
  const targetMonth = base.getUTCMonth() + months

  const lastDayInTarget = new Date(Date.UTC(y, m - 1, 1))
  lastDayInTarget.setUTCMonth(targetMonth + 1, 0) // last day of target month
  const lastDay = lastDayInTarget.getUTCDate()

  const clampedDay = Math.min(d, lastDay)
  const out = new Date(Date.UTC(y, m - 1, clampedDay))
  out.setUTCMonth(targetMonth)
  return out.toISOString().slice(0, 10)
}

function normQR(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const raw = v.trim()
  if (!raw) return null
  // tolère ATOM:xxxx => atom:xxxx
  if (raw.startsWith('ATOM:')) return 'atom:' + raw.slice(5)
  return raw
}

function humanPlan(p: Plan, sessionsTotal?: number | null) {
  switch (p) {
    case '1m':
      return '1 month'
    case '3m':
      return '3 months'
    case '6m':
      return '6 months'
    case '12m':
      return '12 months'
    case 'sessions':
      return `Per sessions${sessionsTotal ? ` (${sessionsTotal})` : ''}`
  }
}

function makeAdminClient(): SupabaseClient<any, any, any, any, any> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient<any>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function tryCreateInvoice(args: {
  admin: SupabaseClient<any, any, any, any, any>
  memberId: string
  subscriptionId: string
  paid_at: string
  currency: string
  snapshot: InvoiceSnapshot
}) {
  const { admin, memberId, subscriptionId, paid_at, currency, snapshot } = args

  // 1) Generate PDF
  const pdfBytes = await generateInvoicePdfBytes(snapshot)

  // 2) Upload to Storage (bucket: invoices)
  const filePath = `${memberId}/${snapshot.invoice_number}.pdf`
  const up = await admin.storage
    .from('invoices')
    .upload(filePath, pdfBytes, { contentType: 'application/pdf', upsert: true })
  if (up.error) throw up.error

  // 3) Insert invoice row
  const { data: inv, error: invErr } = await admin
    .from('invoices')
    .insert({
      member_id: memberId,
      subscription_id: subscriptionId,
      invoice_number: snapshot.invoice_number,
      amount: snapshot.transaction.amount,
      currency,
      paid_at,
      pdf_path: filePath,
      snapshot,
    })
    .select('id, invoice_number, pdf_path')
    .maybeSingle<{ id: string; invoice_number: string; pdf_path: string }>()

  if (invErr) throw invErr
  return inv
}

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    // 1) Auth + staff only
    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) return json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle<{ role: string | null }>()

    if (meErr) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message })

    const role = me?.role ?? 'member'
    const isStaff = ['reception', 'admin', 'super_admin'].includes(role)
    if (!isStaff) return json(403, { ok: false, error: 'FORBIDDEN' })

    // Service role client (to bypass notifications RLS, and triggers if any)
    const admin = makeAdminClient()
    if (!admin) {
      // We can still create the subscription with user session, but notification insert may fail
      // and, if you have a DB trigger inserting into notifications, the subscription insert itself can fail.
      // Better to fail fast with a clear hint.
      return json(500, {
        ok: false,
        error: 'SERVICE_ROLE_MISSING',
        details:
          'SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL) must be set on the server to create subscription notifications safely.',
      })
    }

    // 2) Parse payload
    const body = await req.json().catch(() => ({} as any))

    const planRaw = body?.plan
    if (!isPlan(planRaw)) {
      return json(400, { ok: false, error: 'INVALID_PLAN' })
    }
    const plan: Plan = planRaw

    const amountNum = Number(body?.amount ?? 0)
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      return json(400, { ok: false, error: 'INVALID_AMOUNT', details: 'Amount must be a positive number.' })
    }
    if (amountNum > 1_000_000_000) {
      return json(400, { ok: false, error: 'AMOUNT_TOO_LARGE' })
    }
    const amount = amountNum

    let memberId: string | null = typeof body?.memberId === 'string' ? body.memberId.trim() : null
    const member_qr = normQR(body?.member_qr ?? body?.qr ?? body?.code)
    const member_email = typeof body?.member_email === 'string' ? body.member_email.trim().toLowerCase() : null

    // 3) Resolve member_id (memberId | qr | email)
    if (!memberId) {
      if (member_qr) {
        const { data: profByQr, error: qrErr } = await admin
          .from('profiles')
          .select('user_id')
          .eq('qr_code', member_qr)
          .maybeSingle<{ user_id: string }>()
        if (qrErr) return json(500, { ok: false, error: 'MEMBER_LOOKUP_FAILED', details: qrErr.message })
        memberId = profByQr?.user_id ?? null
      } else if (member_email) {
        const { data: profByEmail, error: emErr } = await admin
          .from('profiles')
          .select('user_id')
          .eq('email', member_email)
          .maybeSingle<{ user_id: string }>()
        if (emErr) return json(500, { ok: false, error: 'MEMBER_LOOKUP_FAILED', details: emErr.message })
        memberId = profByEmail?.user_id ?? null
      }
    }

    if (!memberId) {
      return json(400, {
        ok: false,
        error: 'INVALID_MEMBER_ID',
        details: 'Member not found.',
        hint: 'Provide memberId (uuid) OR member_qr (atom:uuid) OR member_email',
      })
    }

    // Verify member exists
    const { data: exists, error: exErr } = await admin
      .from('profiles')
      .select('user_id, first_name, last_name, email, member_id, created_at')
      .eq('user_id', memberId)
      .maybeSingle<{ user_id: string; first_name: string | null; last_name: string | null; email: string | null; member_id: string | null; created_at: string | null }>()

    if (exErr) return json(500, { ok: false, error: 'PROFILE_CHECK_FAILED', details: exErr.message })
    if (!exists) return json(404, { ok: false, error: 'MEMBER_NOT_FOUND' })

    // 4) Build insert payload
    const paid_at = new Date().toISOString()
    const subscription_type = plan === 'sessions' ? 'sessions' : 'time'
    const status = 'active' as const

    const payload: any = {
      member_id: memberId,
      plan,
      subscription_type,
      status,
      amount,
      paid_at,
    }

    let sessions_total: number | null = null

    if (plan === 'sessions') {
      // Sessions: start_date optional (default today UTC), fixed 45d validity
      const requestedStart = isISODateOnly(body?.start_date) ? String(body.start_date) : dateOnlyUTC()
      const sessionsTotalRaw = Number(body?.sessions_total ?? 10)
      sessions_total = Math.max(1, Math.min(10, Math.floor(Number.isFinite(sessionsTotalRaw) ? sessionsTotalRaw : 10)))

      payload.start_date = requestedStart
      payload.end_date = addDays(requestedStart, 45)
      payload.sessions_total = sessions_total
      payload.sessions_used = 0
    } else {
      // Time plans require start_date
      const start = isISODateOnly(body?.start_date) ? String(body.start_date) : null
      if (!start) {
        return json(400, {
          ok: false,
          error: 'START_DATE_REQUIRED',
          details: 'start_date (YYYY-MM-DD) is required for time plans.',
        })
      }

      const months = plan === '1m' ? 1 : plan === '3m' ? 3 : plan === '6m' ? 6 : 12
      payload.start_date = start
      payload.end_date = addMonthsSafe(start, months)
      payload.sessions_total = null
      payload.sessions_used = null
    }

    // 5) Insert subscription with service role (bypasses RLS + any trigger that inserts notifications)
    const { data: inserted, error: insErr } = await admin
      .from('subscriptions')
      .insert(payload)
      .select('id')
      .maybeSingle<{ id: string }>()

    if (insErr) {
      return json(500, { ok: false, error: 'INSERT_FAILED', details: insErr.message })
    }

    // 6) Try to create a notification for the member (do NOT block subscription if this fails)
    // Notifications insert:
    // - For reception: use the authenticated client so auth.uid() is set (some DB triggers/policies may depend on it)
    // - For admin/super_admin: keep service role (bypass RLS) if available
    const notifClient = role === 'reception' ? supa : admin

    let notification_ok = false
    let notification_error: string | null = null

    // 7) Create invoice PDF (do NOT block subscription if this fails)
    let invoice_ok = false
    let invoice_error: string | null = null
    let invoice: { id: string; invoice_number: string } | null = null

    try {
      const invoice_number = makeInvoiceNumber({ paidAtISO: paid_at, subscriptionId: inserted?.id })
      const snapshot: InvoiceSnapshot = {
        invoice_number,
        issued_at: paid_at,
        gym: { name: 'ATOM Jiu-Jitsu Academy', city: 'Cairo', country: 'Egypt' },
        member: {
          user_id: memberId,
          member_code: exists.member_id ?? null,
          first_name: exists.first_name,
          last_name: exists.last_name,
          email: exists.email,
          joined_at: exists.created_at,
        },
        transaction: {
          subscription_id: inserted?.id ?? '—',
          subscription_type,
          plan,
          start_date: payload.start_date ?? null,
          end_date: payload.end_date ?? null,
          sessions_total: sessions_total,
          amount,
          currency: 'EGP',
          paid_at,
        },
      }

      const invRow = await tryCreateInvoice({
        admin,
        memberId,
        subscriptionId: inserted?.id ?? '',
        paid_at,
        currency: 'EGP',
        snapshot,
      })
      invoice_ok = true
      invoice = invRow ? { id: invRow.id, invoice_number: invRow.invoice_number } : null
    } catch (e: any) {
      invoice_ok = false
      invoice_error = e?.message ?? String(e)
    }

    try {
      const memberName = [exists.first_name ?? '', exists.last_name ?? ''].join(' ').trim() || exists.email || 'Member'
      const end = payload.end_date
      const title = 'Subscription updated'
      const bodyText =
        plan === 'sessions'
          ? `Hi ${memberName}, your ${humanPlan(plan, sessions_total)} package is active. Valid until ${end}.`
          : `Hi ${memberName}, your ${humanPlan(plan)} subscription is active until ${end}.`

      const { error: nErr } = await notifClient.from('notifications').insert({
        user_id: memberId,
        member_id: memberId,
        title,
        body: bodyText,
        kind: 'billing',
        created_by: auth.user.id,
        // read_at intentionally null
      })

      if (nErr) {
        notification_ok = false
        notification_error = nErr.message
      } else {
        notification_ok = true
      }
    } catch (e: any) {
      notification_ok = false
      notification_error = e?.message ?? String(e)
    }

    return json(200, {
      ok: true,
      id: inserted?.id,
      ...payload,
      notification_ok,
      invoice_ok,
      ...(invoice ? { invoice } : {}),
      ...(notification_error ? { notification_error } : {}),
      ...(invoice_error ? { invoice_error } : {}),
    })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
