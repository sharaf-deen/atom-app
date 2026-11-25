import 'server-only'
import { generateInvoicePdfBytes, type InvoiceSnapshot } from '@/lib/invoices'

// This document is a corrective financial record, NOT another cash payment.
// Original receipts and PDF files are deliberately retained and marked superseded.
export async function ensureYasin1440CorrectiveInvoice(admin:any,actorId:string) {
  const memberId='18bed597-5f7e-4518-915f-0c5c5f8d0f05'
  const number='INV-CORR-1440-000150'
  const {data:recovery,error:recoveryErr}=await admin.from('atom_membership_recovery_1440')
    .select('id,member_id,original_subscription_id,corrected_subscription_id,upgrade_id,real_payment_id,deposit_received_egp,outstanding_egp,original_remaining_credit_egp,gross_target_price_egp,promotion_discount_egp')
    .eq('member_id',memberId).maybeSingle()
  if(recoveryErr||!recovery)throw new Error('RECOVERY_NOT_APPLIED')
  const {data:previous,error:previousErr}=await admin.from('invoices')
    .select('id,invoice_number,member_id,subscription_id,amount,snapshot')
    .eq('invoice_number',number).maybeSingle()
  if(previousErr)throw previousErr
  if(previous){
    if(previous.member_id!==memberId||previous.subscription_id!==recovery.corrected_subscription_id
       ||Number(previous.amount)!==2600||previous.snapshot?.recovery?.id!==recovery.id)
      throw new Error('CORRECTIVE_INVOICE_COLLISION')
    return {id:previous.id,invoice_number:previous.invoice_number,already_created:true}
  }
  const [{data:member,error:memberErr},{data:sub,error:subErr},{data:payment,error:payErr},{data:upgrade,error:upgradeErr}]=await Promise.all([
    admin.from('profiles').select('user_id,member_id,first_name,last_name,email,created_at').eq('user_id',memberId).maybeSingle(),
    admin.from('subscriptions').select('id,plan,subscription_type,start_date,end_date,sessions_total,amount,amount_due,payment_method').eq('id',recovery.corrected_subscription_id).maybeSingle(),
    admin.from('subscription_payments').select('id,subscription_id,member_id,amount,paid_at,payment_method').eq('id',recovery.real_payment_id).maybeSingle(),
    admin.from('membership_upgrades').select('id,from_plan,target_price_egp,target_list_price_egp,promotion_id,promotion_title_snapshot,promotion_discount_type_snapshot,promotion_discount_value_snapshot,promotion_discount_egp,transferred_credit_egp').eq('id',recovery.upgrade_id).maybeSingle(),
  ])
  if(memberErr||subErr||payErr||upgradeErr||!member||!sub||!payment||!upgrade)
    throw new Error('CORRECTIVE_INVOICE_SOURCE_MISSING')
  if(payment.member_id!==memberId||payment.subscription_id!==sub.id
      ||Number(payment.amount)!==2600||Number(sub.amount)!==2600||Number(sub.amount_due)!==1294.76
      ||sub.plan!=='3m'||sub.start_date!=='2026-11-25'||sub.end_date!=='2027-02-25')
    throw new Error('CORRECTIVE_INVOICE_RECONCILIATION_FAILED')

  const snapshot:InvoiceSnapshot & {recovery:{id:string;reason:string;superseded_invoice_numbers:string[];false_payment_voided_egp:number;outstanding_egp:number}}={
    invoice_number:number,issued_at:new Date().toISOString(),
    gym:{name:'ATOM Jiu-Jitsu Academy',city:'Cairo',country:'Egypt'},
    member:{user_id:member.user_id,member_code:member.member_id,first_name:member.first_name,
      last_name:member.last_name,email:member.email,joined_at:member.created_at},
    transaction:{subscription_id:sub.id,subscription_type:sub.subscription_type,
      plan:sub.plan,start_date:sub.start_date,end_date:sub.end_date,
      sessions_total:sub.sessions_total,amount:2600,amount_due:1294.76,
      payment_method:'cash',currency:'EGP',paid_at:payment.paid_at},
    upgrade:{from_subscription_id:recovery.original_subscription_id,from_plan:'1m',
      target_price_egp:Number(upgrade.target_price_egp),
      target_list_price_egp:Number(upgrade.target_list_price_egp),
      promotion_id:upgrade.promotion_id,promotion_title:upgrade.promotion_title_snapshot,
      promotion_discount_type:upgrade.promotion_discount_type_snapshot,
      promotion_discount_value:Number(upgrade.promotion_discount_value_snapshot),
      promotion_discount_egp:Number(upgrade.promotion_discount_egp),
      transferred_credit_egp:Number(upgrade.transferred_credit_egp),
      additional_payment_egp:2600},
    recovery:{id:recovery.id,reason:'Corrective 1m → 3m upgrade; no new cash collected by this correction.',
      superseded_invoice_numbers:['INV-20261123-053598D2AF','INV-20261124-053598D2AF'],
      false_payment_voided_egp:400,outstanding_egp:1294.76}
  }
  const bytes=await generateInvoicePdfBytes(snapshot)
  const path=`${memberId}/${number}.pdf`
  const uploaded=await admin.storage.from('invoices').upload(path,bytes,{contentType:'application/pdf',upsert:false})
  if(uploaded.error&&!/already exists|duplicate/i.test(uploaded.error.message||''))throw uploaded.error
  const {data:created,error:insertErr}=await admin.from('invoices').insert({
    member_id:memberId,subscription_id:sub.id,invoice_number:number,
    amount:2600,currency:'EGP',paid_at:payment.paid_at,
    pdf_path:path,snapshot,created_by:actorId,
  }).select('id,invoice_number').maybeSingle()
  if(!insertErr&&created)return {...created,already_created:false}
  if(insertErr?.code==='23505'){
    const {data:existing}=await admin.from('invoices')
      .select('id,invoice_number,member_id,subscription_id,amount,snapshot')
      .eq('invoice_number',number).maybeSingle()
    if(existing?.member_id===memberId&&existing?.subscription_id===sub.id&&Number(existing.amount)===2600&&existing.snapshot?.recovery?.id===recovery.id)
      return {id:existing.id,invoice_number:existing.invoice_number,already_created:true}
  }
  throw insertErr||new Error('CORRECTIVE_INVOICE_SAVE_FAILED')
}
