// Staff Payroll — Hybrid Official Engine 1C
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { cairoDayBoundsUTC } from '@/lib/cairoTime'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import {
  buildPayrollCalculationsHash,
  buildPayrollSnapshotHash,
  buildPayrollSourceHashes,
} from '@/lib/staffPayrollIntegrity'

const STAFF_ROLES = ['assistant_coach','coach','head_coach','reception','admin','super_admin'] as const

function json(status:number, body:any) {
  const response = NextResponse.json(body,{status})
  response.headers.set('Cache-Control','no-store')
  return response
}
function cleanString(value:unknown,max=2000){return typeof value==='string'?value.trim().slice(0,max):''}
function normalizeUuid(value:unknown){
  const raw=cleanString(value,80)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)?raw:''
}
function nextMonthStart(monthStart:string){
  const [year,month]=monthStart.slice(0,7).split('-').map(Number)
  return new Date(Date.UTC(year,month,1)).toISOString().slice(0,10)
}
function makeAdminClient(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY
  if(!url||!key) return null
  return createClient<any>(url,key,{auth:{autoRefreshToken:false,persistSession:false}})
}
async function getActor(){
  const supabase=createSupabaseServerActionClient()
  const {data:auth,error:authError}=await supabase.auth.getUser()
  if(authError||!auth.user) return {actorId:'',role:'',error:authError?.message||'NOT_AUTHENTICATED'}
  const {data:profile,error:profileError}=await supabase.from('profiles').select('role').eq('user_id',auth.user.id).maybeSingle<{role:string|null}>()
  return {actorId:auth.user.id,role:profile?.role??'member',error:profileError?.message??''}
}
async function safeAudit(admin:any,row:any){try{await admin.from('audit_logs').insert(row)}catch{}}

export async function POST(req:Request){
  try{
    const actor=await getActor()
    if(!actor.actorId) return json(401,{ok:false,error:'NOT_AUTHENTICATED',details:actor.error})
    if(actor.error) return json(500,{ok:false,error:'PROFILE_LOOKUP_FAILED',details:actor.error})
    if(actor.role!=='super_admin') return json(403,{ok:false,error:'FORBIDDEN'})

    const admin=makeAdminClient()
    if(!admin) return json(500,{ok:false,error:'SERVICE_ROLE_MISSING'})

    const body=await req.json().catch(()=>({} as any))
    const action=cleanString(body?.action,40)
    const snapshotId=normalizeUuid(body?.snapshotId??body?.snapshot_id)
    if(!snapshotId) return json(400,{ok:false,error:'INVALID_SNAPSHOT_ID'})

    if(action==='approve'){
      const approvalNote=cleanString(body?.approvalNote??body?.approval_note,2000)
      const {data:snapshot,error:snapshotError}=await admin
        .from('staff_payroll_monthly_snapshots')
        .select('id,month_start,status,rate_model,staff_count,missing_hours_task_count,unconfigured_staff_count,calculated_payroll_total,financial_source_hash,task_source_hash,compensation_source_hash,staff_source_hash,draft_snapshot_hash,draft_calculation_hash,coach_session_rate,head_coach_session_rate,coach_session_count,head_coach_session_count,guaranteed_coaching_payroll,variable_payroll_percent,safety_reserve_percent,safety_reserve_amount,variable_payroll_pool,fixed_base_payroll,variable_pool_weighted_hours,variable_weighted_hour_value,eligible_revenue_scope,bonus_pool_percent,membership_revenue,membership_payment_count,paid_membership_refunds,paid_membership_refund_count,net_membership_revenue,eligible_operating_expenses,eligible_expense_count,excluded_payroll_expenses,excluded_payroll_expense_count,operating_result_before_payroll,guaranteed_payroll,minimum_task_payroll,available_result_after_guaranteed_payroll,performance_bonus_pool,dynamic_task_supplement_pool,salary_before_adjustments_total,manual_bonus_total,manual_deduction_total,net_manual_adjustment_total')
        .eq('id',snapshotId).maybeSingle()

      if(snapshotError) return json(500,{ok:false,error:'SNAPSHOT_LOOKUP_FAILED',details:snapshotError.message})
      if(!snapshot?.id) return json(404,{ok:false,error:'SNAPSHOT_NOT_FOUND'})
      if(snapshot.rate_model!=='hybrid_payroll') return json(409,{ok:false,error:'NOT_HYBRID_DRAFT'})
      if(snapshot.status!=='draft') return json(409,{ok:false,error:'PAYROLL_ALREADY_LOCKED'})
      if(Number(snapshot.missing_hours_task_count??0)>0) return json(409,{ok:false,error:'MISSING_HOURS'})
      if(Number(snapshot.unconfigured_staff_count??0)>0) return json(409,{ok:false,error:'UNCONFIGURED_STAFF'})
      if(Number(snapshot.staff_count??0)<1) return json(409,{ok:false,error:'NO_STAFF_IN_DRAFT'})

      const stored={
        financial_source_hash:String(snapshot.financial_source_hash??''),
        task_source_hash:String(snapshot.task_source_hash??''),
        compensation_source_hash:String(snapshot.compensation_source_hash??''),
        staff_source_hash:String(snapshot.staff_source_hash??''),
        draft_snapshot_hash:String(snapshot.draft_snapshot_hash??''),
        draft_calculation_hash:String(snapshot.draft_calculation_hash??''),
      }
      if(Object.values(stored).some(v=>!v)) return json(409,{ok:false,error:'RECALC_REQUIRED',details:'Recalculate the hybrid draft before approval.'})

      const monthStart=String(snapshot.month_start)
      const nextMonth=nextMonthStart(monthStart)
      const startISO=cairoDayBoundsUTC(monthStart).startISO
      const endISO=cairoDayBoundsUTC(nextMonth).startISO

      const [paymentsResult,refundsResult,expensesResult,logsResult,compensationResult,staffResult,adjustmentsResult,calculationsResult]=await Promise.all([
        admin.from('subscription_payments').select('id,amount').gte('paid_at',startISO).lt('paid_at',endISO).limit(100000),
        admin.from('membership_refunds').select('id,amount').eq('status','paid').gte('paid_at',startISO).lt('paid_at',endISO).limit(100000),
        admin.from('expenses').select('id,date,category_key,amount').gte('date',monthStart).lt('date',nextMonth).limit(100000),
        admin.from('staff_monthly_task_logs').select('id,staff_user_id,task_id,task_name_snapshot,area_name_snapshot,unit_snapshot,importance_level_snapshot,importance_multiplier_snapshot,work_quantity,actual_hours,weighted_hours,note,updated_at,voided_at').eq('month_start',monthStart).is('voided_at',null).limit(100000),
        admin.from('staff_compensation_rate_periods').select('id,staff_user_id,effective_from,effective_until,fixed_monthly_base,weighted_hour_rate,bonus_eligible,updated_at,staff_compensation_task_rates(id,task_id,weighted_hour_rate,updated_at)').lte('effective_from',monthStart).or(`effective_until.is.null,effective_until.gt.${monthStart}`).limit(10000),
        admin.from('profiles').select('user_id,email,first_name,last_name,role').in('role',[...STAFF_ROLES]).limit(10000),
        admin.from('staff_payroll_monthly_adjustments').select('id,month_start,staff_user_id,adjustment_type,amount,reason,status,created_at,created_by_name_snapshot').eq('month_start',monthStart).eq('status','active').limit(10000),
        admin.from('staff_payroll_monthly_calculations').select('staff_user_id,staff_name_snapshot,staff_role_snapshot,compensation_configured,compensation_rate_period_id,compensation_effective_from,compensation_effective_until,fixed_monthly_base,weighted_hour_rate,bonus_eligible,active_task_count,missing_hours_task_count,actual_hours,weighted_hours,coaching_sessions,coaching_session_rate,coaching_guarantee,non_coaching_weighted_hours,non_coaching_variable_pay,task_compensation,minimum_task_compensation,dynamic_task_supplement,dynamic_weight_share_percent,guaranteed_compensation,bonus_weight_share_percent,performance_bonus,salary_before_adjustments,manual_bonus,manual_deduction,net_manual_adjustment,calculated_salary,adjustment_breakdown,task_rate_breakdown').eq('snapshot_id',snapshotId).limit(10000),
      ])

      const sourceError=paymentsResult.error?.message||refundsResult.error?.message||expensesResult.error?.message||logsResult.error?.message||compensationResult.error?.message||staffResult.error?.message||adjustmentsResult.error?.message||calculationsResult.error?.message||''
      if(sourceError) return json(500,{ok:false,error:'APPROVAL_SOURCE_LOAD_FAILED',details:sourceError})

      const currentHashes=buildPayrollSourceHashes({
        payments:(paymentsResult.data??[]) as any[],
        refunds:(refundsResult.data??[]) as any[],
        expenses:(expensesResult.data??[]) as any[],
        logs:(logsResult.data??[]) as any[],
        compensationProfiles:(compensationResult.data??[]) as any[],
        staffProfiles:(staffResult.data??[]) as any[],
        adjustments:(adjustmentsResult.data??[]) as any[],
        taskMinimumRates:[],
      })
      const currentSnapshotHash=buildPayrollSnapshotHash(snapshot as any)
      const currentCalculationHash=buildPayrollCalculationsHash((calculationsResult.data??[]) as any[])

      const changed:string[]=[]
      if(currentHashes.financial_source_hash!==stored.financial_source_hash) changed.push('financial data')
      if(currentHashes.task_source_hash!==stored.task_source_hash) changed.push('monthly tasks')
      if(currentHashes.compensation_source_hash!==stored.compensation_source_hash) changed.push('compensation or adjustments')
      if(currentHashes.staff_source_hash!==stored.staff_source_hash) changed.push('staff profiles')
      if(currentSnapshotHash!==stored.draft_snapshot_hash) changed.push('hybrid snapshot')
      if(currentCalculationHash!==stored.draft_calculation_hash) changed.push('hybrid calculations')
      if(changed.length) return json(409,{ok:false,error:'DRAFT_OUTDATED',details:`Draft outdated: ${changed.join(', ')}. Recalculate first.`})

      const {data:rows,error:approvalError}=await admin.rpc('staff_payroll_approve_snapshot',{
        p_snapshot_id:snapshotId,
        p_actor_id:actor.actorId,
        p_approval_note:approvalNote||null,
        p_financial_source_hash:currentHashes.financial_source_hash,
        p_task_source_hash:currentHashes.task_source_hash,
        p_compensation_source_hash:currentHashes.compensation_source_hash,
        p_staff_source_hash:currentHashes.staff_source_hash,
        p_draft_snapshot_hash:currentSnapshotHash,
        p_draft_calculation_hash:currentCalculationHash,
      })
      if(approvalError) return json(409,{ok:false,error:'APPROVAL_FAILED',details:approvalError.message})

      const approval=Array.isArray(rows)?rows[0]:rows
      await safeAudit(admin,{
        actor_user_id:actor.actorId,
        target_user_id:null,
        action:'staff_payroll_hybrid_approved_locked',
        action_details:{
          snapshot_id:snapshotId,month_start:monthStart,
          approval_version_id:approval?.approval_version_id??null,
          version_no:approval?.version_no??null,
          rate_model:'hybrid_payroll',
          calculated_payroll_total:Number(snapshot.calculated_payroll_total??0),
          source_integrity_verified:true,
        },
      })

      revalidatePath('/admin/staff-payroll/calculation')
      revalidatePath('/admin/staff-payroll/monthly-tasks')
      revalidatePath('/admin/staff-payroll/payments')
      revalidatePath('/admin/staff-payroll/adjustments')
      return json(200,{ok:true,versionNo:approval?.version_no??null,approvalVersionId:approval?.approval_version_id??null})
    }

    if(action==='reopen'){
      const reason=cleanString(body?.reason,1000)
      if(reason.length<3) return json(400,{ok:false,error:'REOPEN_REASON_REQUIRED'})
      const {data:snapshot,error:snapshotError}=await admin.from('staff_payroll_monthly_snapshots').select('id,status,rate_model,approval_version_no,month_start').eq('id',snapshotId).maybeSingle()
      if(snapshotError) return json(500,{ok:false,error:'SNAPSHOT_LOOKUP_FAILED',details:snapshotError.message})
      if(!snapshot?.id) return json(404,{ok:false,error:'SNAPSHOT_NOT_FOUND'})
      if(snapshot.rate_model!=='hybrid_payroll') return json(409,{ok:false,error:'NOT_HYBRID_PAYROLL'})
      if(snapshot.status!=='approved') return json(409,{ok:false,error:'PAYROLL_NOT_APPROVED'})

      const {data:rows,error:reopenError}=await admin.rpc('staff_payroll_reopen_snapshot',{p_snapshot_id:snapshotId,p_actor_id:actor.actorId,p_reason:reason})
      if(reopenError) return json(409,{ok:false,error:'REOPEN_FAILED',details:reopenError.message})
      const reopened=Array.isArray(rows)?rows[0]:rows

      await safeAudit(admin,{
        actor_user_id:actor.actorId,target_user_id:null,action:'staff_payroll_hybrid_reopened',
        action_details:{snapshot_id:snapshotId,month_start:snapshot.month_start,reopened_version_no:reopened?.reopened_version_no??snapshot.approval_version_no,reopen_reason:reason}
      })
      revalidatePath('/admin/staff-payroll/calculation')
      revalidatePath('/admin/staff-payroll/monthly-tasks')
      revalidatePath('/admin/staff-payroll/payments')
      revalidatePath('/admin/staff-payroll/adjustments')
      return json(200,{ok:true,reopenedVersionNo:reopened?.reopened_version_no??null})
    }

    return json(400,{ok:false,error:'UNKNOWN_ACTION'})
  }catch(error:any){
    return json(500,{ok:false,error:'SERVER_ERROR',details:error?.message??String(error)})
  }
}
