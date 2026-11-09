// Payroll expense-basis adjustments are not accounting expense edits.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { getSupabaseAdminClientCached } from '@/lib/requestCache'

const PAYROLL_CATEGORIES = new Set(['coaches','reception','assistants','bonuses'])
const json = (body:unknown,status=200) => NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}})
function normalizeMonth(value:unknown) {
  const m=typeof value==='string' && /^20\d\d-(0[1-9]|1[0-2])$/.test(value) ? value : ''
  const now=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit'}).format(new Date()).slice(0,7)
  return m && m < now && m>='2026-08' ? m+'-01' : ''
}
async function adminSession() {
  const me=await getSessionUser()
  return me?.role==='super_admin' ? me : null
}
export async function GET(req:Request){
  if(!await adminSession()) return json({ok:false,error:'FORBIDDEN'},403)
  const month=normalizeMonth(new URL(req.url).searchParams.get('month'))
  if(!month) return json({ok:false,error:'INVALID_MONTH'},400)
  const admin=getSupabaseAdminClientCached()
  const next=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,10)
  const [expenses,exclusions,snapshot]=await Promise.all([
    admin.from('expenses').select('id,date,description,category_key,amount').gte('date',month).lt('date',next).eq('category_key','rent').order('date').limit(1000),
    admin.from('staff_payroll_expense_basis_exclusions').select('month_start,expense_id,excluded_amount,reason,updated_at').eq('month_start',month).limit(1000),
    admin.from('staff_payroll_monthly_snapshots').select('status').eq('month_start',month).maybeSingle(),
  ])
  if(expenses.error||exclusions.error||snapshot.error) return json({ok:false,error:'EXPENSE_BASIS_LOAD_FAILED',details:expenses.error?.message||exclusions.error?.message||snapshot.error?.message},500)
  return json({ok:true,month,expenses:expenses.data??[],exclusions:exclusions.data??[],locked:snapshot.data?.status==='approved'})
}
export async function POST(req:Request){
  const me=await adminSession()
  if(!me) return json({ok:false,error:'FORBIDDEN'},403)
  const input=await req.json().catch(()=>null)
  const month=normalizeMonth(input?.month)
  const expenseId=String(input?.expenseId??'')
  const amount=Number(input?.amount)
  const reason=String(input?.reason??'').trim()
  if(!month||! /^[0-9a-f-]{36}$/i.test(expenseId) || !Number.isFinite(amount)
    || amount<0 || amount>1000000 || Math.round(amount*100)!==amount*100
    || (amount>0 && (reason.length<20 || reason.length>1500)))
  return json({ok:false,error:'INVALID_PAYROLL_BASIS_ADJUSTMENT'},400)
  const admin=getSupabaseAdminClientCached()
  const [expense,snapshot]=await Promise.all([
    admin.from('expenses').select('id,date,description,category_key,amount').eq('id',expenseId).maybeSingle(),
    admin.from('staff_payroll_monthly_snapshots').select('status').eq('month_start',month).maybeSingle(),
  ])
  if(expense.error||snapshot.error) return json({ok:false,error:'DATA_LOOKUP_FAILED'},500)
  if(snapshot.data?.status==='approved') return json({ok:false,error:'PAYROLL_ALREADY_LOCKED'},409)
  if(!expense.data || expense.data.category_key!=='rent' || String(expense.data.date).slice(0,7)!==month.slice(0,7)
    || PAYROLL_CATEGORIES.has(String(expense.data.category_key))
    || amount>Number(expense.data.amount))
    return json({ok:false,error:'EXPENSE_NOT_ELIGIBLE'},409)
  // User enters 0 to remove an adjustment; never delete or alter the underlying expense.
  const mutation=amount===0
    ? await admin.from('staff_payroll_expense_basis_exclusions').delete().eq('month_start',month).eq('expense_id',expenseId)
    : await admin.from('staff_payroll_expense_basis_exclusions').upsert({
        month_start:month,expense_id:expenseId,excluded_amount:amount,reason,
        created_by:me.id,updated_by:me.id,updated_at:new Date().toISOString(),
      },{onConflict:'month_start,expense_id'})
  if(mutation.error) return json({ok:false,error:'EXPENSE_BASIS_SAVE_FAILED',details:mutation.error.message},409)
  const audit=await admin.from('audit_logs').insert({
    actor_user_id:me.id,target_user_id:me.id,action:'payroll_expense_basis_adjusted',
    action_details:{month_start:month,expense_id:expenseId,expense_date:expense.data.date,
      original_expense_amount:Number(expense.data.amount),excluded_from_payroll:amount,
      justification:amount===0?'Adjustment removed':reason,underlying_expense_unchanged:true},
  })
  if(audit.error) return json({ok:false,error:'EXPENSE_BASIS_AUDIT_FAILED',details:audit.error.message},500)
  return json({ok:true,month,amount,requiresRecalculation:true})
}
