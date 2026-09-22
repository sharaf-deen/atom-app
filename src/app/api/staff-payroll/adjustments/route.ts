// Staff Payroll 2F — Monthly Salary Adjustments
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

function cleanString(value: unknown, max = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function normalizeUuid(value: unknown) {
  const raw = cleanString(value, 80)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
    ? raw
    : ''
}

function normalizeMonthStart(value: unknown) {
  const raw = cleanString(value, 20)
  const match = raw.match(/^(\d{4})-(\d{2})(?:-01)?$/)
  if (!match) return ''
  const year = Number(match[1])
  const month = Number(match[2])
  if (year < 2000 || year > 2200 || month < 1 || month > 12) return ''
  return `${match[1]}-${match[2]}-01`
}

function currentCairoMonthStart() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date())
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  return year && month ? `${year}-${month}-01` : new Date().toISOString().slice(0, 7) + '-01'
}

async function getActor() {
  const supabase = createSupabaseServerActionClient()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError || !auth.user) {
    return { actorId: '', role: '', error: authError?.message || 'NOT_AUTHENTICATED' }
  }
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', auth.user.id)
    .maybeSingle<{ role: string | null }>()
  return { actorId: auth.user.id, role: profile?.role ?? 'member', error: error?.message ?? '' }
}

async function safeAudit(admin: any, row: any) {
  try {
    await admin.from('audit_logs').insert(row)
  } catch {
    // The adjustment RPC already preserves the actor and history.
  }
}

function migrationMissing(message: string) {
  const lower = message.toLowerCase()
  return (
    lower.includes('staff_payroll_monthly_adjustments') ||
    lower.includes('staff_payroll_create_monthly_adjustment') ||
    lower.includes('staff_payroll_void_monthly_adjustment') ||
    lower.includes('does not exist')
  )
}

function errorDetails(message: string) {
  if (message.includes('STAFF_PAYROLL_MONTH_LOCKED')) return 'This payroll month is approved and locked.'
  if (message.includes('STAFF_PAYROLL_ADJUSTMENT_REASON_REQUIRED')) return 'A reason of at least 3 characters is required.'
  if (message.includes('STAFF_PAYROLL_ADJUSTMENT_VOID_REASON_REQUIRED')) return 'A void reason of at least 3 characters is required.'
  if (message.includes('STAFF_PAYROLL_INVALID_ADJUSTMENT_AMOUNT')) return 'Enter an amount greater than zero.'
  if (message.includes('STAFF_PAYROLL_INVALID_ADJUSTMENT_TYPE')) return 'Choose Bonus or Deduction.'
  if (message.includes('STAFF_PAYROLL_INVALID_STAFF')) return 'Choose an eligible staff member.'
  if (message.includes('STAFF_PAYROLL_ADJUSTMENT_ALREADY_VOIDED')) return 'This adjustment was already voided.'
  if (message.includes('STAFF_PAYROLL_ADJUSTMENT_NOT_FOUND')) return 'This adjustment no longer exists.'
  return message
}

export async function POST(req: Request) {
  try {
    const actor = await getActor()
    if (!actor.actorId) return json(401, { ok: false, error: 'NOT_AUTHENTICATED', details: actor.error })
    if (actor.error) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: actor.error })
    if (actor.role !== 'super_admin') return json(403, { ok: false, error: 'FORBIDDEN' })

    const admin = makeAdminClient()
    if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_MISSING' })

    const body = await req.json().catch(() => ({} as any))
    const action = cleanString(body?.action, 60)

    if (action === 'create_adjustment') {
      const monthStart = normalizeMonthStart(body?.monthStart ?? body?.month_start)
      const staffUserId = normalizeUuid(body?.staffUserId ?? body?.staff_user_id)
      const adjustmentType = cleanString(body?.adjustmentType ?? body?.adjustment_type, 20)
      const amount = Math.round(Number(body?.amount) * 100) / 100
      const reason = cleanString(body?.reason, 1000)

      if (!monthStart || monthStart < '2026-08-01') return json(400, { ok: false, error: 'INVALID_MONTH' })
      if (monthStart >= currentCairoMonthStart()) {
        return json(400, { ok: false, error: 'MONTH_NOT_CLOSED', details: 'Adjustments are available for completed payroll months only.' })
      }
      if (!staffUserId) return json(400, { ok: false, error: 'INVALID_STAFF' })
      if (!['bonus', 'deduction'].includes(adjustmentType)) return json(400, { ok: false, error: 'INVALID_ADJUSTMENT_TYPE' })
      if (!Number.isFinite(amount) || amount <= 0) return json(400, { ok: false, error: 'INVALID_AMOUNT' })
      if (reason.length < 3) return json(400, { ok: false, error: 'REASON_REQUIRED', details: 'A reason of at least 3 characters is required.' })

      const { data, error } = await admin.rpc('staff_payroll_create_monthly_adjustment', {
        p_month_start: monthStart,
        p_staff_user_id: staffUserId,
        p_adjustment_type: adjustmentType,
        p_amount: amount,
        p_reason: reason,
        p_actor_id: actor.actorId,
      })

      if (error) {
        const message = error.message ?? String(error)
        return json(migrationMissing(message) ? 500 : 409, {
          ok: false,
          error: migrationMissing(message) ? 'MIGRATION_REQUIRED' : 'ADJUSTMENT_CREATE_FAILED',
          details: migrationMissing(message)
            ? 'Deploy the Staff Payroll 2F database migration, then try again.'
            : errorDetails(message),
        })
      }

      await safeAudit(admin, {
        actor_user_id: actor.actorId,
        target_user_id: staffUserId,
        action: 'staff_payroll_monthly_adjustment_created',
        action_details: {
          adjustment_id: data?.id ?? null,
          month_start: monthStart,
          adjustment_type: adjustmentType,
          amount,
          reason,
          payroll_recalculation_required: true,
        },
      })

      revalidatePath('/admin/staff-payroll/adjustments')
      revalidatePath('/admin/staff-payroll/calculation')
      return json(200, { ok: true, adjustmentId: data?.id ?? null })
    }

    if (action === 'void_adjustment') {
      const adjustmentId = normalizeUuid(body?.adjustmentId ?? body?.adjustment_id)
      const reason = cleanString(body?.reason, 1000)
      if (!adjustmentId) return json(400, { ok: false, error: 'INVALID_ADJUSTMENT_ID' })
      if (reason.length < 3) return json(400, { ok: false, error: 'VOID_REASON_REQUIRED', details: 'A void reason of at least 3 characters is required.' })

      const { data, error } = await admin.rpc('staff_payroll_void_monthly_adjustment', {
        p_adjustment_id: adjustmentId,
        p_reason: reason,
        p_actor_id: actor.actorId,
      })

      if (error) {
        const message = error.message ?? String(error)
        return json(migrationMissing(message) ? 500 : 409, {
          ok: false,
          error: migrationMissing(message) ? 'MIGRATION_REQUIRED' : 'ADJUSTMENT_VOID_FAILED',
          details: migrationMissing(message)
            ? 'Deploy the Staff Payroll 2F database migration, then try again.'
            : errorDetails(message),
        })
      }

      await safeAudit(admin, {
        actor_user_id: actor.actorId,
        target_user_id: data?.staff_user_id ?? null,
        action: 'staff_payroll_monthly_adjustment_voided',
        action_details: {
          adjustment_id: adjustmentId,
          month_start: data?.month_start ?? null,
          adjustment_type: data?.adjustment_type ?? null,
          amount: Number(data?.amount ?? 0),
          void_reason: reason,
          payroll_recalculation_required: true,
        },
      })

      revalidatePath('/admin/staff-payroll/adjustments')
      revalidatePath('/admin/staff-payroll/calculation')
      return json(200, { ok: true })
    }

    return json(400, { ok: false, error: 'UNKNOWN_ACTION' })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message ?? String(error) })
  }
}
