export type FulfillmentSubscription = {
  id:string; plan:string; status:string; member_id:string; created_at:string;
  start_date:string|null; amount:number|null; amount_due:number|null
}
export type FulfillmentRequest = {
  member_id:string;plan:string;source_subscription_id:string|null;
  created_at:string;approved_price_egp:number;payment_verified_amount_egp:number|null
}
export type OriginalSubscription = {status:string;end_date:string|null}|null
const moneyEqual=(a:number,b:number)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=0.01

/** Pure finalization guard; requires ledger rows that were already filtered by member_id. */
export function eligibleForRenewalFulfillment(args:{
  candidate:FulfillmentSubscription;request:FulfillmentRequest;source:OriginalSubscription;
  alreadyLinked:boolean;ledgerAmount:number;ledgerCount:number
}):boolean{
 const {candidate:c,request:r,source,alreadyLinked,ledgerAmount,ledgerCount}=args
 const amount=Number(c.amount??0),due=Number(c.amount_due??0)
 const approved=Number(r.approved_price_egp),verified=Number(r.payment_verified_amount_egp)
 if(alreadyLinked||c.id===r.source_subscription_id)return false
 if(c.member_id!==r.member_id||c.plan!==r.plan)return false
 if(!['active','expired'].includes(c.status)||!c.created_at||c.created_at<r.created_at)return false
 if(!moneyEqual(amount+due,approved)||due>0.01||due<0||amount<0)return false
 if(r.payment_verified_amount_egp===null||!moneyEqual(amount,verified))return false
 if(amount>0 && (ledgerCount<=0||!moneyEqual(ledgerAmount,amount)))return false
 if(amount===0 && ledgerAmount>0.01)return false
 if(source?.status==='active'&&source.end_date&&(!c.start_date||c.start_date<=source.end_date))return false
 return true
}
