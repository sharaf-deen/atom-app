// Staff Payroll 1E — Salary Payments & Payment Tracking
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

function json(status: number, body: any) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null

  return createClient<any>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function cleanString(value: unknown, max = 2000) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

function normalizeUuid(value: unknown) {
  const raw = cleanString(value, 80)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
    ? raw
    : ''
}

function normalizeDate(value: unknown) {
  const raw = cleanString(value, 20)
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : ''
}

function normalizeAmount(value: unknown) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return Math.round(amount * 100) / 100
}

async function getActor() {
  const supabase = createSupabaseServerActionClient()
  const { data: auth, error: authError } = await supabase.auth.getUser()

  if (authError || !auth.user) {
    return {
      actorId: '',
      role: '',
      error: authError?.message || 'NOT_AUTHENTICATED',
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', auth.user.id)
    .maybeSingle<{ role: string | null }>()

  return {
    actorId: auth.user.id,
    role: profile?.role ?? 'member',
    error: profileError?.message ?? '',
  }
}

async function safeAudit(admin: any, row: any) {
  try {
    await admin.from('audit_logs').insert(row)
  } catch {
    // Audit should not break the payment workflow after the DB RPC succeeded.
  }
}

function isMigrationMissing(message: string) {
  const lower = message.toLowerCase()
  return (
    lower.includes('staff_payroll_salary_payments') ||
    lower.includes('staff_payroll_record_salary_payment') ||
    lower.includes('staff_payroll_reverse_salary_payment') ||
    lower.includes('does not exist')
  )
}

function rpcErrorDetails(message: string) {
  if (message.includes('STAFF_PAYROLL_PAYMENT_AMOUNT_INVALID')) {
    return 'Payment amount must be greater than zero.'
  }
  if (message.includes('STAFF_PAYROLL_PAYMENT_METHOD_INVALID')) {
    return 'Use Cash, Instapay, or Bank Transfer for salary payments.'
  }
  if (message.includes('STAFF_PAYROLL_PAYMENT_DATE_FUTURE')) {
    return 'Salary payment date cannot be in the future.'
  }
  if (message.includes('STAFF_PAYROLL_PAYMENT_NOT_CURRENT_APPROVAL')) {
    return 'Payments can only be recorded against the currently approved payroll version.'
  }
  if (message.includes('STAFF_PAYROLL_PAYMENT_EXCEEDS_REMAINING')) {
    return 'Payment exceeds the remaining salary due.'
  }
  if (message.includes('STAFF_PAYROLL_PAYMENT_ALREADY_PAID')) {
    return 'This approved salary is already fully paid.'
  }
  if (message.includes('STAFF_PAYROLL_PAYMENT_REVERSAL_REASON_REQUIRED')) {
    return 'A reason is required to reverse a salary payment.'
  }
  if (message.includes('STAFF_PAYROLL_PAYMENT_ALREADY_REVERSED')) {
    return 'This salary payment was already reversed.'
  }
  if (message.includes('STAFF_PAYROLL_PAYMENT_NOT_FOUND')) {
    return 'Salary payment not found.'
  }
  return message
}

export async function POST(req: Request) {
  try {
    const actor = await getActor()

    if (!actor.actorId) {
      return json(401, {
        ok: false,
        error: 'NOT_AUTHENTICATED',
        details: actor.error,
      })
    }

    if (actor.error) {
      return json(500, {
        ok: false,
        error: 'PROFILE_LOOKUP_FAILED',
        details: actor.error,
      })
    }

    if (actor.role !== 'super_admin') {
      return json(403, { ok: false, error: 'FORBIDDEN' })
    }

    const admin = makeAdminClient()
    if (!admin) {
      return json(500, {
        ok: false,
        error: 'SERVICE_ROLE_MISSING',
        details:
          'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the server.',
      })
    }

    const body = await req.json().catch(() => ({} as any))
    const action = cleanString(body?.action, 40)

    if (action === 'record') {
      const approvalCalculationId = normalizeUuid(
        body?.approvalCalculationId ?? body?.approval_calculation_id
      )
      const amount = normalizeAmount(body?.amount)
      const paymentMethod = cleanString(
        body?.paymentMethod ?? body?.payment_method,
        40
      ).toLowerCase()
      const paymentDate = normalizeDate(body?.paymentDate ?? body?.payment_date)
      const reference = cleanString(body?.reference, 300)
      const note = cleanString(body?.note, 2000)

      if (!approvalCalculationId) {
        return json(400, {
          ok: false,
          error: 'INVALID_APPROVAL_CALCULATION_ID',
        })
      }
      if (amount === null) {
        return json(400, {
          ok: false,
          error: 'INVALID_AMOUNT',
          details: 'Payment amount must be greater than zero.',
        })
      }
      if (!['cash', 'instapay', 'bank_transfer'].includes(paymentMethod)) {
        return json(400, {
          ok: false,
          error: 'INVALID_PAYMENT_METHOD',
          details: 'Use Cash, Instapay, or Bank Transfer.',
        })
      }
      if (!paymentDate) {
        return json(400, {
          ok: false,
          error: 'INVALID_PAYMENT_DATE',
        })
      }

      const { data: rows, error } = await admin.rpc(
        'staff_payroll_record_salary_payment',
        {
          p_approval_calculation_id: approvalCalculationId,
          p_actor_id: actor.actorId,
          p_amount: amount,
          p_payment_method: paymentMethod,
          p_payment_date: paymentDate,
          p_reference: reference || null,
          p_note: note || null,
        }
      )

      if (error) {
        const message = error.message ?? String(error)
        return json(isMigrationMissing(message) ? 500 : 409, {
          ok: false,
          error: isMigrationMissing(message)
            ? 'MIGRATION_REQUIRED'
            : 'SALARY_PAYMENT_FAILED',
          details: isMigrationMissing(message)
            ? 'Apply Staff Payroll 1E migration, then try again.'
            : rpcErrorDetails(message),
        })
      }

      const result = Array.isArray(rows) ? rows[0] : rows

      await safeAudit(admin, {
        actor_user_id: actor.actorId,
        target_user_id: null,
        action: 'staff_payroll_salary_payment_recorded',
        action_details: {
          approval_calculation_id: approvalCalculationId,
          payment_id: result?.payment_id ?? null,
          amount,
          payment_method: paymentMethod,
          payment_date: paymentDate,
          reference: reference || null,
          remaining_due: result?.remaining_due ?? null,
          payment_status: result?.payment_status ?? null,
          note_scope:
            'Salary payment ledger only. No Expenses or Payments Reconciliation record was created automatically.',
        },
      })

      revalidatePath('/admin/staff-payroll/payments')
      revalidatePath('/admin/staff-payroll/calculation')

      return json(200, {
        ok: true,
        paymentId: result?.payment_id ?? null,
        paidTotal: Number(result?.paid_total ?? 0),
        remainingDue: Number(result?.remaining_due ?? 0),
        paymentStatus: result?.payment_status ?? null,
      })
    }

    if (action === 'reverse') {
      const paymentId = normalizeUuid(body?.paymentId ?? body?.payment_id)
      const reason = cleanString(body?.reason, 1000)

      if (!paymentId) {
        return json(400, { ok: false, error: 'INVALID_PAYMENT_ID' })
      }
      if (reason.length < 3) {
        return json(400, {
          ok: false,
          error: 'REVERSAL_REASON_REQUIRED',
          details: 'A reason of at least 3 characters is required.',
        })
      }

      const { data: existing } = await admin
        .from('staff_payroll_salary_payments')
        .select(
          'id,staff_user_id,staff_name_snapshot,month_start,approval_version_no,amount,payment_method,payment_date,status'
        )
        .eq('id', paymentId)
        .maybeSingle()

      const { data: rows, error } = await admin.rpc(
        'staff_payroll_reverse_salary_payment',
        {
          p_payment_id: paymentId,
          p_actor_id: actor.actorId,
          p_reason: reason,
        }
      )

      if (error) {
        const message = error.message ?? String(error)
        return json(isMigrationMissing(message) ? 500 : 409, {
          ok: false,
          error: isMigrationMissing(message)
            ? 'MIGRATION_REQUIRED'
            : 'SALARY_PAYMENT_REVERSAL_FAILED',
          details: isMigrationMissing(message)
            ? 'Apply Staff Payroll 1E migration, then try again.'
            : rpcErrorDetails(message),
        })
      }

      const result = Array.isArray(rows) ? rows[0] : rows

      await safeAudit(admin, {
        actor_user_id: actor.actorId,
        target_user_id: existing?.staff_user_id ?? null,
        action: 'staff_payroll_salary_payment_reversed',
        action_details: {
          payment_id: result?.payment_id ?? paymentId,
          month_start: existing?.month_start ?? null,
          approval_version_no: existing?.approval_version_no ?? null,
          staff_name: existing?.staff_name_snapshot ?? null,
          amount: Number(existing?.amount ?? 0),
          payment_method: existing?.payment_method ?? null,
          payment_date: existing?.payment_date ?? null,
          reversal_reason: reason,
          note_scope: 'Salary payment reversal only. Original ledger row remains preserved.',
        },
      })

      revalidatePath('/admin/staff-payroll/payments')
      revalidatePath('/admin/staff-payroll/calculation')

      return json(200, {
        ok: true,
        paymentId: result?.payment_id ?? paymentId,
      })
    }

    return json(400, { ok: false, error: 'UNKNOWN_ACTION' })
  } catch (error: any) {
    return json(500, {
      ok: false,
      error: 'SERVER_ERROR',
      details: error?.message ?? String(error),
    })
  }
}
