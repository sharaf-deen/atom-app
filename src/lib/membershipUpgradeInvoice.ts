import { generateInvoicePdfBytes, makeInvoiceNumber, type InvoiceSnapshot } from '@/lib/invoices'

// The upgrade transaction has already committed. Invoice issuance is retryable,
// idempotent by the stable invoice_number derived from the new subscription ID.
// Never create a second subscription or payment to retry an invoice.
export async function ensureMembershipUpgradeInvoice(
 admin: any,
 upgradeId: string,
 actorId: string,
): Promise<{id:string;invoice_number:string}|null> {
 const {data:upgrade,error:uErr}=await admin.from('membership_upgrades')
  .select('id,member_id,from_subscription_id,to_subscription_id,from_plan,to_plan,transferred_credit_egp,target_price_egp,additional_payment_egp,additional_payment_id')
  .eq('id',upgradeId).maybeSingle()
 if(uErr||!upgrade)throw new Error('UPGRADE_INVOICE_SOURCE_MISSING')
 const supplement=Number(upgrade.additional_payment_egp)
 const credit=Number(upgrade.transferred_credit_egp)
 const price=Number(upgrade.target_price_egp)
 if(![supplement,credit,price].every(v=>Number.isFinite(v)&&v>=0)
     ||Math.abs(supplement+credit-price)>0.01)
   throw new Error('UPGRADE_INVOICE_AMOUNT_MISMATCH')
 if(supplement===0)return null // Nothing newly collected: no new cash invoice.
 if(!upgrade.additional_payment_id)throw new Error('UPGRADE_INVOICE_PAYMENT_LINK_MISSING')

 const {data:existing,error:existingErr}=await admin.from('invoices')
  .select('id,invoice_number,subscription_id').eq('subscription_id',upgrade.to_subscription_id).limit(2)
 if(existingErr)throw existingErr
 if(existing?.length){
   if(existing.length!==1)throw new Error('MULTIPLE_INVOICES_FOR_UPGRADE')
   return {id:existing[0].id,invoice_number:existing[0].invoice_number}
 }

 const [p,s,paid]=await Promise.all([
  admin.from('profiles').select('user_id,member_id,first_name,last_name,email,created_at').eq('user_id',upgrade.member_id).maybeSingle(),
  admin.from('subscriptions').select('id,plan,subscription_type,start_date,end_date,sessions_total,amount,amount_due,payment_method').eq('id',upgrade.to_subscription_id).maybeSingle(),
  admin.from('subscription_payments').select('id,subscription_id,member_id,amount,paid_at,payment_method').eq('id',upgrade.additional_payment_id).maybeSingle(),
 ])
 if(p.error||s.error||paid.error||!p.data||!s.data||!paid.data)
   throw new Error('UPGRADE_INVOICE_FINANCIAL_LOOKUP_FAILED')
 if(paid.data.subscription_id!==upgrade.to_subscription_id||paid.data.member_id!==upgrade.member_id
  ||Math.abs(Number(paid.data.amount)-supplement)>0.01)
   throw new Error('UPGRADE_INVOICE_PAYMENT_MISMATCH')
 const number=makeInvoiceNumber({paidAtISO:paid.data.paid_at,subscriptionId:upgrade.to_subscription_id})
 const snapshot:InvoiceSnapshot={
  invoice_number:number,issued_at:new Date().toISOString(),
  gym:{name:'ATOM Jiu-Jitsu Academy',city:'Cairo',country:'Egypt'},
  member:{
    user_id:p.data.user_id,member_code:p.data.member_id,
    first_name:p.data.first_name,last_name:p.data.last_name,
    email:p.data.email,joined_at:p.data.created_at,
  },
  transaction:{
    subscription_id:s.data.id,subscription_type:s.data.subscription_type,
    plan:s.data.plan,start_date:s.data.start_date,end_date:s.data.end_date,
    sessions_total:s.data.sessions_total,
    amount:supplement,amount_due:0,payment_method:paid.data.payment_method,
    currency:'EGP',paid_at:paid.data.paid_at,
  },
  upgrade:{
    from_subscription_id:upgrade.from_subscription_id,
    from_plan:upgrade.from_plan,target_price_egp:price,
    transferred_credit_egp:credit,additional_payment_egp:supplement,
  },
 }
 const path=`${upgrade.member_id}/${number}.pdf`
 const bytes=await generateInvoicePdfBytes(snapshot)
 const upload=await admin.storage.from('invoices').upload(path,bytes,{
   contentType:'application/pdf',upsert:false,
 })
 if(upload.error&&!/already exists|duplicate/i.test(upload.error.message||''))throw upload.error

 const {data:created,error:insertErr}=await admin.from('invoices').insert({
  member_id:upgrade.member_id,subscription_id:upgrade.to_subscription_id,
  invoice_number:number,amount:supplement,currency:'EGP',
  paid_at:paid.data.paid_at,pdf_path:path,snapshot,created_by:actorId,
 }).select('id,invoice_number').maybeSingle()
 if(!insertErr&&created)return created
 if(insertErr?.code==='23505'){
  const {data:reused,error:readErr}=await admin.from('invoices')
    .select('id,invoice_number,subscription_id').eq('invoice_number',number).maybeSingle()
  if(!readErr&&reused?.subscription_id===upgrade.to_subscription_id)
   return {id:reused.id,invoice_number:reused.invoice_number}
 }
 throw insertErr||new Error('UPGRADE_INVOICE_SAVE_FAILED')
}
