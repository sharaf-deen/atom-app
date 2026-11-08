// Coaching Monthly Declaration Integrity — authenticated, server-reviewed workflow.
// No direct client writes or automatic salary approval.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { getSupabaseAdminClientCached } from '@/lib/requestCache'

function json(data: unknown, status = 200) {
  const response = NextResponse.json(data, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function normalizeMonth(value: string | null) {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null
  const now = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit',
  }).format(new Date()).slice(0, 7)
  if (value > now || value < '2025-01') return null
  return value
}

function nextMonth(month: string) {
  const [y, m] = month.split('-').map(Number)
  const date = new Date(Date.UTC(y, m, 1))
  return date.toISOString().slice(0, 7) + '-01'
}

const allowed = new Set(['super_admin'])

export async function GET(req: Request) {
  const me = await getSessionUser()
  if (!me || !allowed.has(me.role)) return json({ ok: false, error: 'FORBIDDEN' }, 403)
  const month = normalizeMonth(new URL(req.url).searchParams.get('month'))
  if (!month) return json({ ok: false, error: 'INVALID_MONTH' }, 400)
  const monthStart = month + '-01'
  const monthEnd = nextMonth(month)
  const isAdmin = me.role === 'super_admin'
  const admin = getSupabaseAdminClientCached()

  let declarationsQuery = admin.from('staff_payroll_coaching_monthly_declarations')
    .select('id,month_start,staff_user_id,submitted_by,payroll_task_id,declared_sessions,declared_hours,coach_note,status,review_note,reviewed_at,monthly_task_log_id,updated_at')
    .eq('month_start', monthStart)
    .order('updated_at', { ascending: false })

  const [declarationsResult, tasksResult, profilesResult, sessionsResult, mappingsResult, linksResult] =
    await Promise.all([
      declarationsQuery,
      admin.from('staff_tasks').select('id,name,importance_multiplier').eq('unit', 'class').eq('is_active', true).order('name'),
      isAdmin ? admin.from('staff_payroll_staff_profiles').select('staff_user_id,primary_role,employment_status') : Promise.resolve({ data: [], error: null }),
      admin.from('schedule_training_sessions').select('id,class_template_id,session_date')
        .gte('session_date',monthStart).lt('session_date',monthEnd).neq('status','cancelled'),
      admin.from('staff_payroll_coaching_template_mappings').select('class_template_id,payroll_task_id').eq('is_active',true),
      admin.from('staff_payroll_account_links').select('linked_user_id,staff_user_id'),
    ])
  const readError = [declarationsResult.error,tasksResult.error,profilesResult.error,sessionsResult.error,
    mappingsResult.error,linksResult.error].find(Boolean)
  if (readError) return json({ ok: false, error: 'MONTHLY_DECLARATIONS_READ_FAILED' },500)

  const sessions = sessionsResult.data ?? []
  const sessionIds = sessions.map((row: any) => String(row.id))
  const { data: assignments, error: assignmentError } = sessionIds.length
    ? await admin.from('schedule_session_coach_assignments')
      .select('training_session_id,staff_user_id').eq('is_active',true).in('training_session_id',sessionIds)
    : { data: [], error: null }
  if (assignmentError) return json({ ok: false, error: 'SCHEDULE_COMPARISON_FAILED' },500)

  const profileIds = isAdmin
    ? Array.from(new Set([...(profilesResult.data ?? []).map((x: any)=>String(x.staff_user_id)),
      ...(declarationsResult.data ?? []).map((x: any)=>String(x.staff_user_id))]))
    : []
  const { data: names, error: nameError } = await admin.from('profiles')
    .select('user_id,first_name,last_name,role').in('user_id',profileIds)
  if (nameError) return json({ ok: false, error: 'PROFILE_LOOKUP_FAILED' },500)
  const namesById = new Map((names ?? []).map((row: any) => [
    String(row.user_id),
    [row.first_name,row.last_name].filter(Boolean).join(' ') || String(row.user_id).slice(0,8),
  ]))
  const canonical = new Map((linksResult.data ?? []).map((row: any) =>
    [String(row.linked_user_id), String(row.staff_user_id)]))
  const mapping = new Map((mappingsResult.data ?? []).map((row: any) =>
    [String(row.class_template_id),String(row.payroll_task_id)]))
  const templates = new Map(sessions.map((row: any) => [String(row.id),String(row.class_template_id)]))
  const scheduled = new Map<string,number>()
  for (const assignment of assignments ?? []) {
    const taskId = mapping.get(templates.get(String(assignment.training_session_id)) ?? '')
    if (!taskId) continue
    const canonicalId = canonical.get(String(assignment.staff_user_id)) ?? String(assignment.staff_user_id)
    const key = canonicalId + ':' + taskId
    scheduled.set(key,(scheduled.get(key) ?? 0)+1)
  }

  const declarations = (declarationsResult.data ?? []).map((row: any) => ({
    ...row,
    staff_name: namesById.get(String(row.staff_user_id)) ?? 'Staff',
    scheduled_assignments: scheduled.get(String(row.staff_user_id)+':'+String(row.payroll_task_id)) ?? 0,
  }))
  return json({
    ok: true, month, staffId: null, isAdmin,
    tasks: tasksResult.data ?? [], declarations,
    staff: isAdmin
      ? (profilesResult.data ?? []).map((row: any) => ({
        ...row, name: namesById.get(String(row.staff_user_id)) ?? 'Staff',
      }))
      : [],
  })
}

export async function POST(req: Request) {
  const me = await getSessionUser()
  if (!me || !allowed.has(me.role)) return json({ ok: false, error: 'FORBIDDEN' }, 403)
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'INVALID_BODY' },400)
  const action = String(body.action ?? '')
  const supabase = createSupabaseServerActionClient()

  if (action === 'submit') {
    const month = normalizeMonth(String(body.month ?? ''))
    const count = Number(body.sessions)
    const hours = Number(body.hours)
    const taskId = String(body.taskId ?? '')
    const note = String(body.note ?? '').trim()
    const staffId = String(body.staffId ?? '')
    if (me.role !== 'super_admin' || !month || !/^[a-f0-9-]{36}$/i.test(taskId) || !/^[a-f0-9-]{36}$/i.test(staffId)
      || !Number.isInteger(count) || count<1 || count>250
      || !Number.isFinite(hours) || hours<=0 || hours>500 || Math.abs(Math.round(hours*100)-hours*100)>0.00001
      || note.length>1500) return json({ ok:false,error:'INVALID_DECLARATION' },400)
    const { data,error } = await (supabase as any).rpc('staff_payroll_admin_record_coaching_month_v1',{
      p_staff_user_id:staffId,
      p_month_start:month+'-01',p_payroll_task_id:taskId,p_declared_sessions:count,
      p_declared_hours:hours,p_note:note,
    })
    if (error) return json({ok:false,error:String(error.message ?? 'SUBMIT_FAILED')},409)
    return json({ok:true,result:data})
  }
  if (action === 'review') {
    if (me.role!=='super_admin') return json({ok:false,error:'FORBIDDEN'},403)
    const decision = String(body.decision ?? '')
    const id = String(body.id ?? '')
    const reason = String(body.reason ?? '').trim()
    if (!['approve','reject'].includes(decision) || !/^[0-9a-f-]{36}$/i.test(id)
      || reason.length<10 || reason.length>1500)
      return json({ok:false,error:'INVALID_REVIEW'},400)
    const {data,error}=await (supabase as any).rpc('staff_payroll_review_coaching_month_v1',{
      p_declaration_id:id,p_decision:decision,p_reason:reason,
    })
    if(error) return json({ok:false,error:String(error.message??'REVIEW_FAILED')},409)
    return json({ok:true,result:data})
  }
  return json({ok:false,error:'UNKNOWN_ACTION'},400)
}
