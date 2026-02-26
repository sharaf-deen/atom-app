export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { generateInvoicePdfBytes, makeInvoiceNumber, type InvoiceSnapshot } from '@/lib/invoices'

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function isFiniteNumber(n: any) {
  const v = Number(n)
  return Number.isFinite(v)
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient<any>(url, key, { auth: { persistSession: false } })
}

const ACTION_SUB_DUE_SETTLE = 'subscription_due_settle'

async function safeAudit(admin: any, row: any) {
  try {
    await admin.from('audit_logs').insert(row)
  } catch {
    // audit must never break the flow
  }
}

function isAllowedPaymentMethod(v: any) {
  return v === 'cash' || v === 'instapay' || v === 'card' || v === 'bank_transfer'
}

async function trySendResendEmail(args: { to: string; subject: string; text: string }) {
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

  const actorId = me.data.user.id

  let body: any = null
  try {
    body = await req.json()
  } catch {
    body = null
  }

  const id = String(body?.id ?? '')
  if (!id) return json(400, { ok: false, error: 'Missing subscription id' })

  const amountPaidRaw = body?.amount_paid
  const amountDueRaw = body?.amount_due
  const paymentMethodRaw = body?.payment_method
  const invoiceRequested = body?.invoice?.generate === true
  const invoiceEmailRequested = body?.invoice?.email === true
  const noteRaw = body?.note

  // Role (to allow staff to settle for any member)
  const { data: prof } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', actorId)
    .maybeSingle<{ role: string | null }>()

  const role = prof?.role ?? 'member'
  const isStaff = ['admin', 'super_admin'].includes(role)

  const admin = makeAdminClient()
  if (!admin) return json(500, { ok: false, error: 'Missing service role key' })

  // Read current subscription
  const { data: current, error: curErr } = await admin
    .from('subscriptions')
    .select(
      'id, member_id, subscription_type, plan, start_date, end_date, sessions_total, amount, amount_due, payment_method, paid_at'
    )
    .eq('id', id)
    .maybeSingle<{
      id: string
      member_id: string
      subscription_type: 'time' | 'sessions' | null
      plan: string | null
      start_date: string | null
      end_date: string | null
      sessions_total: number | null
      amount: any
      amount_due: any
      payment_method: string | null
      paid_at: string | null
    }>()

  if (curErr) return json(500, { ok: false, error: curErr.message })
  if (!current) return json(404, { ok: false, error: 'Subscription not found' })

  // Only admin/super_admin can settle dues
  if (!isStaff) {
    return json(403, { ok: false, error: 'Forbidden' })
  }

  // In this app: amount = paid so far, amount_due = remaining due
  const amountPaidSoFar = Number(current.amount ?? 0)
  const due = Number(current.amount_due ?? 0)

  if (!Number.isFinite(amountPaidSoFar) || amountPaidSoFar < 0) {
    return json(400, { ok: false, error: 'Invalid paid amount' })
  }
  if (!Number.isFinite(due) || due < 0) {
    return json(400, { ok: false, error: 'Invalid current due' })
  }

  // Determine new due
  let newDue: number | null = null
  let paidNow: number | null = null

  if (amountPaidRaw !== undefined && amountPaidRaw !== null && String(amountPaidRaw) !== '') {
    if (!isFiniteNumber(amountPaidRaw)) return json(400, { ok: false, error: 'Invalid amount_paid' })
    paidNow = Number(amountPaidRaw)
    if (paidNow <= 0) return json(400, { ok: false, error: 'amount_paid must be > 0' })
    if (paidNow > due) return json(400, { ok: false, error: 'amount_paid cannot exceed current due' })
    newDue = Math.max(0, due - paidNow)
  } else if (amountDueRaw !== undefined && amountDueRaw !== null && String(amountDueRaw) !== '') {
    // Direct set (staff only)
    if (!isFiniteNumber(amountDueRaw)) return json(400, { ok: false, error: 'Invalid amount_due' })
    const d = Number(amountDueRaw)
    if (d < 0) return json(400, { ok: false, error: 'amount_due must be >= 0' })
    newDue = d
  }

  if (newDue === null) {
    return json(400, { ok: false, error: 'Missing amount_paid (or amount_due)' })
  }

  // Payment method (optional)
  let payment_method: string | null = null
  if (paymentMethodRaw !== undefined && paymentMethodRaw !== null && String(paymentMethodRaw) !== '') {
    const pm = String(paymentMethodRaw)
    if (!isAllowedPaymentMethod(pm)) {
      return json(400, { ok: false, error: 'Invalid payment_method' })
    }
    payment_method = pm
  }

  const update: any = { amount_due: newDue }

  // If we're recording a payment now, increase "paid so far" by that amount.
  // This keeps the total (paid + due) consistent.
  if (paidNow && paidNow > 0) {
    update.amount = Math.max(0, amountPaidSoFar + paidNow)
  }
  if (payment_method) update.payment_method = payment_method

  const { data: updated, error: updErr } = await admin
    .from('subscriptions')
    .update(update)
    .eq('id', id)
    .select(
      'id, member_id, subscription_type, plan, start_date, end_date, sessions_total, amount, amount_due, payment_method, paid_at'
    )
    .maybeSingle()

  

// Audit log (best-effort)
await safeAudit(admin, {
  actor_user_id: actorId,
  target_user_id: current.member_id,
  action: ACTION_SUB_DUE_SETTLE,
  action_details: {
    subscription_id: id,
    paid_now: paidNow ?? null,
    old_due: due,
    new_due: newDue,
    payment_method: payment_method ?? current.payment_method ?? null,
    invoice_requested: invoiceRequested,
    invoice_email_requested: invoiceEmailRequested,
  },
})



if (updErr) return json(500, { ok: false, error: updErr.message })


// Record payment in history (best-effort)
if (paidNow && paidNow > 0) {
  try {
    const note = typeof noteRaw === 'string' ? noteRaw.trim().slice(0, 500) : null
    const pm = String(payment_method ?? current.payment_method ?? 'cash')
    await admin.from('subscription_payments').insert({
      subscription_id: id,
      member_id: current.member_id,
      amount: paidNow,
      payment_method: pm,
      note: note || null,
      created_by: actorId,
    })
  } catch {
    // history must never break settlement
  }
}


  // Optional invoice generation (re-issue / overwrite)
  let invoice_ok = false
  let invoice_error: string | null = null
  let email_sent = false
  let email_error: string | null = null
  let invoice: { id: string; invoice_number: string } | null = null

  if (invoiceRequested) {
    try {
      const memberId = String((updated as any)?.member_id ?? current.member_id)
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

      const paid_at = (updated as any)?.paid_at ?? current.paid_at ?? new Date().toISOString()
      const issued_at = new Date().toISOString()
      const invoice_number = makeInvoiceNumber({ paidAtISO: paid_at, subscriptionId: id })

      const amountFinal = Number((updated as any)?.amount ?? current.amount ?? 0)
      const dueFinal = Number((updated as any)?.amount_due ?? newDue ?? 0)
      const pmFinal = String((updated as any)?.payment_method ?? payment_method ?? current.payment_method ?? 'cash')
      const currency = 'EGP' as const

      const transaction: any = {
        subscription_id: id,
        subscription_type: String((updated as any)?.subscription_type ?? current.subscription_type ?? ''),
        plan: String((updated as any)?.plan ?? current.plan ?? ''),
        start_date: (updated as any)?.start_date ?? current.start_date ?? null,
        end_date: (updated as any)?.end_date ?? current.end_date ?? null,
        sessions_total: (updated as any)?.sessions_total ?? current.sessions_total ?? null,
        amount: amountFinal,
        amount_due: dueFinal,
        payment_method: pmFinal,
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

      const pdfBytes = await generateInvoicePdfBytes(snapshot)
      const filePath = `${memberId}/${invoice_number}.pdf`
      const up = await admin.storage
        .from('invoices')
        .upload(filePath, pdfBytes, { contentType: 'application/pdf', upsert: true })
      if (up.error) throw up.error

      const { data: inv, error: invErr } = await admin
        .from('invoices')
        .upsert(
          {
            member_id: memberId,
            subscription_id: id,
            invoice_number,
            amount: amountFinal,
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

      if (invoiceEmailRequested) {
        const to = member.email
        if (!to) {
          email_sent = false
          email_error = 'MEMBER_EMAIL_MISSING'
        } else {
          const { data: signed, error: sErr } = await admin.storage
            .from('invoices')
            .createSignedUrl(filePath, 60 * 60 * 24 * 7)
          if (sErr) throw sErr
          const url = signed?.signedUrl
          if (!url) throw new Error('SIGNED_URL_MISSING')

          const subject = 'Your updated invoice'
          const text = `Hi ${member.first_name ?? ''},\n\nYour invoice has been updated.\n\nDownload (valid 7 days):\n${url}\n\nATOM Jiu-Jitsu Academy`

          const sent = await trySendResendEmail({ to, subject, text })
          if ((sent as any)?.sent) {
            email_sent = true
          } else {
            email_sent = false
            email_error = (sent as any)?.reason ?? 'EMAIL_NOT_SENT'
          }
        }
      }
    } catch (e: any) {
      invoice_ok = false
      invoice_error = e?.message ?? String(e)
    }
  }

  try {
    revalidateTag('members')
  } catch {}
  if (invoiceRequested) {
    try {
      revalidateTag('invoices')
    } catch {}
    try {
      revalidatePath('/invoices')
    } catch {}
  }
  try {
    revalidatePath('/members')
  } catch {}
  try {
    revalidatePath('/profile')
  } catch {}

  return json(200, {
    ok: true,
    id,
    amount_due: newDue,
    paid_now: paidNow,
    invoice_ok,
    invoice_error,
    invoice,
    email_sent,
    email_error,
  })
}
