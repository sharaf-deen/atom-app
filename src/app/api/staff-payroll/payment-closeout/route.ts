// Staff Payroll 2K — Payroll Approval & Payment Closeout
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
    // Audit must not break the closeout workflow after the DB RPC succeeded.
  }
}

function isMigrationMissing(message: string) {
  const lower = message.toLowerCase()
  return (
    lower.includes('staff_payroll_payment_closeouts') ||
    lower.includes('staff_payroll_close_payment_cycle') ||
    lower.includes('staff_payroll_reopen_payment_closeout') ||
    lower.includes('does not exist')
  )
}

function rpcErrorDetails(message: string) {
  if (message.includes('STAFF_PAYROLL_PAYMENT_CLOSEOUT_NOT_CURRENT_APPROVAL')) {
    return 'Payment closeout is only available for the currently approved payroll version.'
  }
  if (message.includes('STAFF_PAYROLL_PAYMENT_CLOSEOUT_ALREADY_CLOSED')) {
    return 'This approved payroll version is already payment-closed.'
  }
  if (message.includes('STAFF_PAYROLL_PAYMENT_CLOSEOUT_NO_STAFF')) {
    return 'There are no approved staff salary calculations to close.'
  }
  if (message.includes('STAFF_PAYROLL_PAYMENT_CLOSEOUT_NOT_FULLY_PAID')) {
    return 'Every salary must be fully paid before the payment cycle can be closed.'
  }
  if (message.includes('STAFF_PAYROLL_PAYMENT_CLOSEOUT_TOTAL_MISMATCH')) {
    return 'Active payment totals do not exactly match the payable approved salaries. Review the payment ledger before closing.'
  }
  if (message.includes('STAFF_PAYROLL_PAYMENT_CLOSEOUT_REOPEN_REASON_REQUIRED')) {
    return 'A reason is required to reopen a closed payment cycle.'
  }
  if (message.includes('STAFF_PAYROLL_PAYMENT_CLOSEOUT_ALREADY_REOPENED')) {
    return 'This payment closeout was already reopened.'
  }
  if (message.includes('STAFF_PAYROLL_PAYMENT_CLOSEOUT_NOT_FOUND')) {
    return 'Payment closeout record not found.'
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

    if (action === 'close') {
      const approvalVersionId = normalizeUuid(
        body?.approvalVersionId ?? body?.approval_version_id
      )
      const note = cleanString(body?.note, 2000)

      if (!approvalVersionId) {
        return json(400, { ok: false, error: 'INVALID_APPROVAL_VERSION_ID' })
      }

      const { data: version } = await admin
        .from('staff_payroll_approval_versions')
        .select('id,snapshot_id,month_start,version_no,calculated_payroll_total,staff_count')
        .eq('id', approvalVersionId)
        .maybeSingle()

      const { data: rows, error } = await admin.rpc(
        'staff_payroll_close_payment_cycle',
        {
          p_approval_version_id: approvalVersionId,
          p_actor_id: actor.actorId,
          p_note: note || null,
        }
      )

      if (error) {
        const message = error.message ?? String(error)
        return json(isMigrationMissing(message) ? 500 : 409, {
          ok: false,
          error: isMigrationMissing(message)
            ? 'MIGRATION_REQUIRED'
            : 'PAYMENT_CLOSEOUT_FAILED',
          details: isMigrationMissing(message)
            ? 'Required Staff Payroll 2K database changes are not available yet. Deploy the latest database changes, then try again.'
            : rpcErrorDetails(message),
        })
      }

      const result = Array.isArray(rows) ? rows[0] : rows

      await safeAudit(admin, {
        actor_user_id: actor.actorId,
        target_user_id: null,
        action: 'staff_payroll_payment_cycle_closed',
        action_details: {
          closeout_id: result?.closeout_id ?? null,
          approval_version_id: approvalVersionId,
          snapshot_id: version?.snapshot_id ?? null,
          month_start: version?.month_start ?? null,
          approval_version_no: version?.version_no ?? null,
          approved_payroll_total: Number(version?.calculated_payroll_total ?? 0),
          paid_total: Number(result?.paid_total ?? 0),
          payment_count: Number(result?.payment_count ?? 0),
          staff_count: Number(result?.staff_count ?? version?.staff_count ?? 0),
          closeout_note: note || null,
          note_scope:
            'Final payment closeout only. Payroll approval remains immutable and salary-payment ledger writes are locked until an explicit payment-closeout reopen.',
        },
      })

      revalidatePath('/admin/staff-payroll/payments')
      revalidatePath('/admin/staff-payroll/calculation')
      revalidatePath('/admin/staff-payroll/accounting')

      return json(200, {
        ok: true,
        closeoutId: result?.closeout_id ?? null,
        closedAt: result?.closed_at ?? null,
        paidTotal: Number(result?.paid_total ?? 0),
        paymentCount: Number(result?.payment_count ?? 0),
        staffCount: Number(result?.staff_count ?? 0),
      })
    }

    if (action === 'reopen') {
      const closeoutId = normalizeUuid(body?.closeoutId ?? body?.closeout_id)
      const reason = cleanString(body?.reason, 1000)

      if (!closeoutId) {
        return json(400, { ok: false, error: 'INVALID_CLOSEOUT_ID' })
      }
      if (reason.length < 3) {
        return json(400, {
          ok: false,
          error: 'REOPEN_REASON_REQUIRED',
          details: 'A reason of at least 3 characters is required.',
        })
      }

      const { data: existing } = await admin
        .from('staff_payroll_payment_closeouts')
        .select('id,approval_version_id,snapshot_id,month_start,approval_version_no,active_payment_total,active_payment_count,staff_count,status')
        .eq('id', closeoutId)
        .maybeSingle()

      const { data: rows, error } = await admin.rpc(
        'staff_payroll_reopen_payment_closeout',
        {
          p_closeout_id: closeoutId,
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
            : 'PAYMENT_CLOSEOUT_REOPEN_FAILED',
          details: isMigrationMissing(message)
            ? 'Required Staff Payroll 2K database changes are not available yet. Deploy the latest database changes, then try again.'
            : rpcErrorDetails(message),
        })
      }

      const result = Array.isArray(rows) ? rows[0] : rows

      await safeAudit(admin, {
        actor_user_id: actor.actorId,
        target_user_id: null,
        action: 'staff_payroll_payment_cycle_reopened',
        action_details: {
          closeout_id: result?.closeout_id ?? closeoutId,
          approval_version_id: existing?.approval_version_id ?? null,
          snapshot_id: existing?.snapshot_id ?? null,
          month_start: existing?.month_start ?? null,
          approval_version_no: existing?.approval_version_no ?? null,
          paid_total_at_closeout: Number(existing?.active_payment_total ?? 0),
          payment_count_at_closeout: Number(existing?.active_payment_count ?? 0),
          staff_count: Number(existing?.staff_count ?? 0),
          reopen_reason: reason,
          note_scope:
            'Payment closeout reopened. The underlying approved payroll is still locked; payment corrections may now be recorded/reversed.',
        },
      })

      revalidatePath('/admin/staff-payroll/payments')
      revalidatePath('/admin/staff-payroll/calculation')
      revalidatePath('/admin/staff-payroll/accounting')

      return json(200, {
        ok: true,
        closeoutId: result?.closeout_id ?? closeoutId,
        reopenedAt: result?.reopened_at ?? null,
      })
    }

    return json(400, { ok: false, error: 'UNKNOWN_ACTION' })
  } catch (caught: any) {
    return json(500, {
      ok: false,
      error: 'UNEXPECTED_ERROR',
      details: caught?.message ?? String(caught),
    })
  }
}
