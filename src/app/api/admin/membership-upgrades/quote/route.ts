import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { cairoToday } from '@/lib/cairoDate'
import { isHigherPlan,isUpgradePlan,quoteUpgrade } from '@/lib/membershipUpgradeMath'
export const dynamic='force-dynamic'
export const runtime='nodejs'

function reply(status:number,body:unknown) {
 const res=NextResponse.json(body,{status});res.headers.set('Cache-Control','no-store');return res
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PRICES: Record<string,{unit:string;qty:number}>={
 '1w':{unit:'week',qty:1},'1m':{unit:'month',qty:1},'3m':{unit:'month',qty:3},
 '6m':{unit:'month',qty:6},'12m':{unit:'month',qty:12},
}
export async function GET(request:Request) {
 try {
  const session=createSupabaseServerActionClient()
  const {data:auth,error:authError}=await session.auth.getUser()
  if(authError||!auth.user)return reply(401,{ok:false,error:'NOT_AUTHENTICATED'})
  const {data:actor,error:actorError}=await session.from('profiles').select('role').eq('user_id',auth.user.id).maybeSingle()
  if(actorError)return reply(500,{ok:false,error:'ROLE_LOOKUP_FAILED'})
  if(actor?.role !== 'super_admin')return reply(403,{ok:false,error:'FORBIDDEN'})
  const input=new URL(request.url).searchParams
  const subscriptionId=input.get('subscription_id')||''
  const targetPlan=input.get('target_plan')||''
  const paymentDate=input.get('payment_date')||cairoToday()
  const effectiveDate=cairoToday() // NEVER backdate coverage merely because a payment was received earlier
  if(!UUID.test(subscriptionId))return reply(400,{ok:false,error:'INVALID_SUBSCRIPTION'})
  if(!isUpgradePlan(targetPlan))return reply(400,{ok:false,error:'INVALID_TARGET_PLAN'})
  if(!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)||Number.isNaN(Date.parse(paymentDate+'T00:00:00Z'))||
    new Date(paymentDate+'T00:00:00Z').toISOString().slice(0,10)!==paymentDate ||paymentDate>effectiveDate)
    return reply(400,{ok:false,error:'INVALID_PAYMENT_DATE'})
  const db=createSupabaseAdminClient()
  const {data:sub,error:subError}=await db.from('subscriptions')
    .select('id,member_id,plan,subscription_type,status,start_date,end_date,amount,amount_due,frozen_until')
    .eq('id',subscriptionId).maybeSingle()
  if(subError)return reply(500,{ok:false,error:'SUBSCRIPTION_LOOKUP_FAILED'})
  if(!sub)return reply(404,{ok:false,error:'SUBSCRIPTION_NOT_FOUND'})
  if(sub.subscription_type!=='time'||!isUpgradePlan(sub.plan)||!isHigherPlan(sub.plan,targetPlan))
    return reply(409,{ok:false,error:'ONLY_HIGHER_TIME_PLANS_SUPPORTED'})
  if(sub.status!=='active'||!sub.start_date||!sub.end_date||sub.start_date>effectiveDate||sub.end_date<effectiveDate)
    return reply(409,{ok:false,error:'SUBSCRIPTION_NOT_ACTIVE'})
  if(sub.frozen_until&&sub.frozen_until>=effectiveDate)
    return reply(409,{ok:false,error:'FROZEN_SUBSCRIPTION_REQUIRES_REVIEW'})
  const [{data:payments,error:paymentsError},{data:refunds,error:refundError},{data:freezes,error:freezeError},
    {data:priorUpgrade,error:priorError},{data:openRenewals,error:renewalsError}]=await Promise.all([
    db.from('subscription_payments').select('id,amount').eq('subscription_id',subscriptionId),
    db.from('membership_refunds').select('id,status').eq('subscription_id',subscriptionId),
    db.from('subscription_freezes').select('id').eq('subscription_id',subscriptionId).is('cleared_at',null).limit(1),
    db.from('membership_upgrades').select('transferred_credit_egp').eq('to_subscription_id',subscriptionId).maybeSingle(),
    db.from('membership_renewal_requests').select('id').eq('member_id',sub.member_id)
     .not('status','in','(completed,rejected,cancelled)').limit(1),
  ])
  if(paymentsError||refundError||freezeError||priorError||renewalsError)return reply(500,{ok:false,error:'FINANCIAL_HISTORY_LOOKUP_FAILED'})
  // Any linked refund/freeze requires a separate Super Admin reconciliation, rather than silently overcrediting.
  if((refunds||[]).some(r=>r.status!=='rejected'&&r.status!=='cancelled')||(freezes||[]).length)
    return reply(409,{ok:false,error:'EXISTING_REFUND_OR_FREEZE_REQUIRES_REVIEW'})
  if((openRenewals||[]).length)return reply(409,{ok:false,error:'OPEN_RENEWAL_REQUEST_REQUIRES_REVIEW'})
  if(Number(sub.amount_due||0)>0)return reply(409,{ok:false,error:'OLD_SUBSCRIPTION_HAS_OUTSTANDING_DUES'})
  const ledgerTotal=(payments||[]).reduce((sum,p)=>sum+Number(p.amount),0)
  const paidTotal=Number(sub.amount||0)
  if(!Number.isFinite(paidTotal)||paidTotal<0||!Number.isFinite(ledgerTotal)||Math.abs(ledgerTotal-paidTotal)>.01)
    return reply(409,{ok:false,error:'PAID_LEDGER_MISMATCH_REQUIRES_REVIEW'})
  const key=PRICES[targetPlan]
  const {data:prices,error:priceError}=await db.from('packages_pricing')
     .select('id,name,price_egp').eq('type','membership').eq('unit',key.unit).eq('qty',key.qty).eq('is_active',true).limit(2)
  if(priceError||!prices||prices.length!==1)return reply(409,{ok:false,error:'TARGET_PRICE_UNAVAILABLE'})
  const carriedCredit=Number(priorUpgrade?.transferred_credit_egp||0)
  if(!Number.isFinite(carriedCredit)||carriedCredit<0)return reply(409,{ok:false,error:'INVALID_CARRIED_CREDIT'})
  const quote=quoteUpgrade({startDate:sub.start_date,endDate:sub.end_date,effectiveDate,
    capturedPaidEGP:ledgerTotal+carriedCredit,targetPriceEGP:Number(prices[0].price_egp)})
  return reply(200,{ok:true,preview_only:true,subscription_id:subscriptionId,member_id:sub.member_id,
    from_plan:sub.plan,to_plan:targetPlan,package_id:prices[0].id,package_name:prices[0].name,
    payment_date:paymentDate,quoted_at:new Date().toISOString(),quote,
    financial_sources:{cash_received_on_current_subscription_egp:ledgerTotal,carried_credit_from_previous_upgrade_egp:carriedCredit},
    note:'Preview only. No payment recorded, no membership upgraded. The final approval must re-check all amounts and dates atomically.'})
 }catch(e:any){return reply(500,{ok:false,error:e?.message||'QUOTE_FAILED'})}
}
