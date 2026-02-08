// src/app/api/subscriptions/update/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { generateInvoicePdfBytes, makeInvoiceNumber, type InvoiceSnapshot } from '@/lib/invoices'

function json(status: number, body: any) {
  return NextResponse.json(body, { status })
}

function isISODateOnly(s?: string | null) {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function addMonthsSafe(dateOnly: string, months: number) {
  const [y, m, d] = dateOnly.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, d))
  const targetMonth = base.getUTCMonth() + months

  // last day of target month
  const tmp = new Date(Date.UTC(y, m - 1, 1))
  tmp.setUTCMonth(targetMonth + 1, 0)
  const lastDay = tmp.getUTCDate()

  const clampedDay = Math.min(d, lastDay)
  const out = new Date(Date.UTC(y, m - 1, clampedDay))
  out.setUTCMonth(targetMonth)
  return out.toISOString().slice(0, 10)
}

function planToMonths(plan: string) {
  switch (plan) {
    case '1m':
      return 1
    case '3m':
      return 3
    case '6m':
      return 6
    case '12m':
      return 12
    default:
      return 0
  }
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient<any>(url, key, { auth: { persistSession: false } })
}

async function trySendResendEmail(args: {
  to: string
  subject: string
  text: string
}) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.MAIL_FROM || 'noreply@example.com'
  if (!apiKey) return { sent: false, reason: 'RESEND_API_KEY_MISSING' }

  const { to, subject, text } = args

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, text }),
  })

  if (!r.ok) {
    const err = await r.text().catch(() => '')
    return { sent: false, reason: `HTTP_${r.status}: ${err}` }
  }

  return { sent: true as const }
}

export async function POST(req: Request) {
  const supabase = createSupabaseServerActionClient()
  const me = await supabase.auth.getUser()
  if (!me.data.user) return json(401, { ok: false, error: 'Not authenticated' })

  // Only admin / super_admin
  const { data: prof } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', me.data.user.id)
    .maybeSingle<{ role: string | null }>()

  const role = prof?.role ?? 'member'
  if (role !== 'admin' && role !== 'super_admin') {
    return json(403, { ok: false, error: 'Forbidden' })
  }

  const admin = makeAdminClient()
  if (!admin) return json(500, { ok: false, error: 'Missing service role key' })

  let body: any = null
  try {
    body = await req.json()
  } catch {
    body = null
  }

  const id = String(body?.id || '')
  const patch = body?.patch ?? null
  const invoiceRequested = body?.invoice?.generate === true
  const invoiceEmailRequested = body?.invoice?.email === true

  if (!id) return json(400, { ok: false, error: 'Missing subscription id' })
  if (!patch || typeof patch !== 'object') return json(400, { ok: false, error: 'Missing patch' })

  // Read current subscription to apply safe rules (plan -> end_date, etc.)
  const { data: current, error: curErr } = await admin
    .from('subscriptions')
    .select('id, member_id, subscription_type, start_date, end_date, plan, status, frozen_until, sessions_total, sessions_used, amount, paid_at')
    .eq('id', id)
    .maybeSingle<{
      id: string
      member_id: string
      subscription_type: 'time' | 'sessions' | null
      start_date: string | null
      end_date: string | null
      plan: string | null
      status: string | null
      frozen_until: string | null
      sessions_total: number | null
      sessions_used: number | null
      amount: number | null
      paid_at: string | null
    }>()

  if (curErr) return json(500, { ok: false, error: curErr.message })
  if (!current) return json(404, { ok: false, error: 'Subscription not found' })

  const update: any = {}

  // Amount
  if (patch.amount !== undefined) {
    const amount = Number(patch.amount)
    if (!Number.isFinite(amount) || amount < 0) return json(400, { ok: false, error: 'Invalid amount' })
    update.amount = amount
  }

  // Status (optional) — only allow existing DB values (prevents "suspended")
  if (patch.status !== undefined) {
    const s = String(patch.status)
    if (!['active', 'expired'].includes(s)) {
      return json(400, {
        ok: false,
        error: `Invalid status: ${s}. Allowed: active, expired`,
      })
    }
    update.status = s
  }

  // Start/end date (optional)
  if (patch.start_date !== undefined) {
    const sd = String(patch.start_date)
    if (!isISODateOnly(sd)) return json(400, { ok: false, error: 'Invalid start_date (YYYY-MM-DD)' })
    update.start_date = sd
  }
  if (patch.end_date !== undefined) {
    const ed = String(patch.end_date)
    if (!isISODateOnly(ed)) return json(400, { ok: false, error: 'Invalid end_date (YYYY-MM-DD)' })
    update.end_date = ed
  }

  // Plan (time subscriptions)
  if (patch.plan !== undefined) {
    const p = String(patch.plan)
    if (!['1m', '3m', '6m', '12m', 'sessions'].includes(p)) {
      return json(400, { ok: false, error: 'Invalid plan' })
    }
    update.plan = p
  }

  // Sessions total (sessions subscriptions)
  if (patch.sessions_total !== undefined) {
    const st = Number(patch.sessions_total)
    if (!Number.isFinite(st) || st < 1) return json(400, { ok: false, error: 'Invalid sessions_total' })
    update.sessions_total = Math.floor(st)
  }

  // If time subscription and start_date/plan were edited (or only one), compute end_date
  if (current.subscription_type === 'time' && (patch.plan !== undefined || patch.start_date !== undefined)) {
    const finalStart = (update.start_date as string | undefined) ?? current.start_date
    const finalPlan = (update.plan as string | undefined) ?? current.plan

    if (!finalStart || !isISODateOnly(finalStart)) {
      return json(400, { ok: false, error: 'Start date is required for time plans' })
    }
    if (!finalPlan || typeof finalPlan !== 'string') {
      return json(400, { ok: false, error: 'Plan is required for time plans' })
    }
    if (finalPlan === 'sessions') {
      return json(400, { ok: false, error: 'Invalid plan for time subscription' })
    }

    const months = planToMonths(finalPlan)
    if (months <= 0) return json(400, { ok: false, error: 'Invalid plan' })

    update.plan = finalPlan
    update.start_date = finalStart
    update.end_date = addMonthsSafe(finalStart, months)
  }

  // For session subscriptions, ignore plan changes silently (UI won’t send it)
  if (current.subscription_type === 'sessions' && patch.plan !== undefined) {
    delete update.plan
  }

  if (Object.keys(update).length === 0) {
    return json(400, { ok: false, error: 'Nothing to update' })
  }

  const { data: updated, error: updErr } = await admin
    .from('subscriptions')
    .update(update)
    .eq('id', id)
    .select('id, member_id, subscription_type, plan, status, start_date, end_date, frozen_until, sessions_total, sessions_used, amount, paid_at')
    .maybeSingle()

  if (updErr) return json(500, { ok: false, error: updErr.message })

  let invoice_ok = false
  let invoice_error: string | null = null
  let email_sent = false
  let email_error: string | null = null
  let invoice: { id: string; invoice_number: string } | null = null

  if (invoiceRequested) {
    try {
      const memberId = (updated as any)?.member_id ?? (current as any)?.member_id
      if (!memberId) throw new Error('MEMBER_ID_MISSING')

      const { data: member, error: mErr } = await admin
        .from('profiles')
        .select('user_id, email, first_name, last_name, member_id, created_at')
        .eq('user_id', memberId)
        .maybeSingle<{
          user_id: string
          email: string | null
          first_name: string | null
          last_name: string | null
          member_id: string | null
          created_at: string | null
        }>()
      if (mErr) throw mErr
      if (!member) throw new Error('MEMBER_NOT_FOUND')

      const paid_at = (updated as any)?.paid_at ?? (current as any)?.paid_at ?? new Date().toISOString()
      const issued_at = new Date().toISOString()
      const invoice_number = makeInvoiceNumber({ paidAtISO: paid_at, subscriptionId: id })

      const amount = Number((updated as any)?.amount ?? (current as any)?.amount ?? 0)
      const currency = 'EGP' as const

      // Use `any` here to avoid tight coupling to the InvoiceSnapshot type shape
      const transaction: any = {
        subscription_id: id,
        subscription_type: String((updated as any)?.subscription_type ?? (current as any)?.subscription_type ?? ''),
        plan: String((updated as any)?.plan ?? (current as any)?.plan ?? ''),
        start_date: (updated as any)?.start_date ?? (current as any)?.start_date ?? null,
        end_date: (updated as any)?.end_date ?? (current as any)?.end_date ?? null,
        sessions_total: (updated as any)?.sessions_total ?? (current as any)?.sessions_total ?? null,
        amount,
        currency,
        paid_at,
      }

      const snapshot = {
        invoice_number,
        issued_at,
        gym: { name: 'ATOM Jiu-Jitsu Academy', city: 'Cairo', country: 'Egypt' },
        member: {
          user_id: member.user_id,
          member_code: member.member_id,
          first_name: member.first_name,
          last_name: member.last_name,
          email: member.email,
          joined_at: member.created_at,
        },
        transaction,
      } as unknown as InvoiceSnapshot

      // 1) Generate PDF
      const pdfBytes = await generateInvoicePdfBytes(snapshot)

      // 2) Upload to Storage (bucket: invoices)
      const filePath = `${memberId}/${invoice_number}.pdf`
      const up = await admin.storage.from('invoices').upload(filePath, pdfBytes, { contentType: 'application/pdf', upsert: true })
      if (up.error) throw up.error

      // 3) Upsert invoice row (same invoice_number can be regenerated after edits)
      // Why upsert? invoice_number is UNIQUE, and for edits we want to overwrite the previous invoice
      // (same payment) instead of failing with a duplicate-key error.
      const { data: inv, error: invErr } = await admin
        .from('invoices')
        .upsert(
          {
            member_id: memberId,
            subscription_id: id,
            invoice_number,
            amount,
            currency,
            paid_at,
            pdf_path: filePath,
            snapshot,
          },
          { onConflict: 'invoice_number' }
        )
        .select('id, invoice_number')
        .maybeSingle<{ id: string; invoice_number: string }>()
      if (invErr) throw invErr

      invoice_ok = true
      invoice = inv ? { id: inv.id, invoice_number: inv.invoice_number } : null

      // Optional: email a signed download link (7 days)
      if (invoiceEmailRequested) {
        const to = member.email
        if (!to) {
          email_sent = false
          email_error = 'MEMBER_EMAIL_MISSING'
        } else {
          const { data: signed, error: sErr } = await admin.storage.from('invoices').createSignedUrl(filePath, 60 * 60 * 24 * 7)
          if (sErr) {
            email_sent = false
            email_error = sErr.message
          } else {
            const signedUrl = (signed as any)?.signedUrl as string | undefined
            const name = ([member.first_name ?? '', member.last_name ?? ''].join(' ').trim() || to) as string
            const subject = `ATOM Invoice ${invoice_number}`
            const text =
              `Hi ${name},\n\n` +
              `Your updated invoice is ready.\n` +
              `Invoice: ${invoice_number}\n` +
               `Amount: ${amount} ${currency}\n` +
              `Paid at: ${paid_at}\n\n` +
              (signedUrl ? `Download (valid 7 days): ${signedUrl}\n\n` : '') +
              `You can also find all your invoices in the app: My Profile → Invoices.\n\n` +
              `ATOM Jiu-Jitsu Academy`

            const sent = await trySendResendEmail({ to, subject, text })
            if (sent.sent) {
              email_sent = true
            } else {
              email_sent = false
              email_error = sent.reason || 'EMAIL_FAILED'
            }
          }
        }
      }
    } catch (e: any) {
      invoice_ok = false
      invoice_error = e?.message ?? String(e)
    }
  }

  return json(200, {
    ok: true,
    subscription: updated,
    ...(invoiceRequested
      ? {
          invoice_ok,
          ...(invoice ? { invoice } : {}),
          ...(invoice_error ? { invoice_error } : {}),
          email_sent,
          ...(email_error ? { email_error } : {}),
        }
      : {}),
  })
}