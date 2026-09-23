// Staff Payroll 2H — Dynamic Task Rates & Guaranteed Minimums
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

function json(status: number, body: any) { const response = NextResponse.json(body, { status }); response.headers.set('Cache-Control', 'no-store'); return response }
function clean(value: unknown, max = 2000) { return typeof value === 'string' ? value.trim().slice(0, max) : '' }
function month(value: unknown) { const raw = clean(value, 20); return /^\d{4}-(0[1-9]|1[0-2])(?:-01)?$/.test(raw) ? `${raw.slice(0, 7)}-01` : '' }
function adminClient() { const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY; return url && key ? createClient<any>(url, key, { auth: { autoRefreshToken: false, persistSession: false } }) : null }

async function actor() {
  const supabase = createSupabaseServerActionClient()
  const { data: auth, error } = await supabase.auth.getUser()
  if (error || !auth.user) return { id: '', role: '' }
  const profile = await supabase.from('profiles').select('role').eq('user_id', auth.user.id).maybeSingle<{ role: string | null }>()
  return { id: auth.user.id, role: profile.data?.role ?? 'member' }
}

export async function POST(req: Request) {
  try {
    const me = await actor()
    if (!me.id) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })
    if (me.role !== 'super_admin') return json(403, { ok: false, error: 'FORBIDDEN' })
    const admin = adminClient()
    if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_MISSING' })
    const body = await req.json().catch(() => ({}))
    if (clean(body?.action, 40) !== 'save_task_minimum_rates') return json(400, { ok: false, error: 'UNKNOWN_ACTION' })
    const effectiveFrom = month(body?.effectiveFrom)
    const rates = Array.isArray(body?.rates) ? body.rates.map((row: any) => ({ task_id: clean(row?.taskId, 80), minimum_hourly_rate: Number(row?.minimumHourlyRate) })) : []
    if (!effectiveFrom || !rates.length || rates.some((row: any) => !row.task_id || !Number.isFinite(row.minimum_hourly_rate) || row.minimum_hourly_rate < 0)) return json(400, { ok: false, error: 'INVALID_RATES' })
    const basis = { model: 'three_month_capacity', history_months: Number(body?.historyMonths ?? 0), reserve_percent: Number(body?.reservePercent ?? 20), average_operating_result: Number(body?.averageOperatingResult ?? 0), average_fixed_payroll: Number(body?.averageFixedPayroll ?? 0), average_weighted_hours: Number(body?.averageWeightedHours ?? 0), saved_at: new Date().toISOString() }
    const result = await admin.rpc('staff_payroll_save_task_minimum_rates', { p_effective_from: effectiveFrom, p_rates: rates, p_recommendation_basis: basis, p_actor_id: me.id })
    if (result.error) {
      const message = result.error.message ?? String(result.error)
      const detail = message.includes('MUST_FOLLOW_APPROVED_MONTH') ? 'The effective month must be after the latest approved payroll.' : message.includes('ALL_ACTIVE_TASK_RATES_REQUIRED') ? 'A rate is required for every active task.' : message
      return json(message.toLowerCase().includes('does not exist') ? 500 : 409, { ok: false, error: 'SAVE_FAILED', details: detail })
    }
    await admin.from('audit_logs').insert({ actor_user_id: me.id, target_user_id: null, action: 'staff_payroll_task_minimum_rates_saved', action_details: { effective_from: effectiveFrom, task_count: rates.length, recommendation_basis: basis } })
    revalidatePath('/admin/staff-payroll/dynamic-rates')
    revalidatePath('/admin/staff-payroll/calculation')
    return json(200, { ok: true, count: Number(result.data ?? rates.length) })
  } catch (error: any) { return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message ?? String(error) }) }
}
