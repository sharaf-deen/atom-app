-- ATOM #1440: narrow, audited repair of renewal entered instead of a prepaid upgrade.
-- No cash backdating, no deletion of historical invoices or validated batch entries.
create table if not exists public.atom_membership_recovery_1440 (
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references public.profiles(user_id),
 original_subscription_id uuid not null unique references public.subscriptions(id),
 corrected_subscription_id uuid not null unique references public.subscriptions(id),
 real_payment_id uuid not null unique references public.subscription_payments(id),
 false_payment_id uuid not null unique references public.subscription_payments(id),
 upgrade_id uuid not null unique references public.membership_upgrades(id),
 effective_date date not null,
 original_old_subscription jsonb not null,
 original_wrong_subscription jsonb not null,
 false_receipt_snapshot jsonb not null,
 gross_target_price_egp numeric(12,2) not null,
 promotion_discount_egp numeric(12,2) not null,
 original_remaining_credit_egp numeric(12,2) not null,
 agreed_upgrade_supplement_egp numeric(12,2) not null,
 deposit_received_egp numeric(12,2) not null,
 outstanding_egp numeric(12,2) not null,
 created_by uuid not null references public.profiles(user_id),
 created_at timestamptz not null default now(),
 reason text not null,
 constraint atom_recovery_balance check (
   agreed_upgrade_supplement_egp=deposit_received_egp+outstanding_egp
   and gross_target_price_egp>=promotion_discount_egp
   and deposit_received_egp>0 and outstanding_egp>0
 )
);
create table if not exists public.atom_payment_voids (
 payment_id uuid primary key references public.subscription_payments(id),
 recovery_id uuid not null references public.atom_membership_recovery_1440(id),
 member_id uuid not null references public.profiles(user_id),
 voided_amount_egp numeric(12,2) not null check(voided_amount_egp>0),
 void_reason text not null,
 created_by uuid not null references public.profiles(user_id),
 created_at timestamptz not null default now()
);
-- A corrective invoice is unique: retries cannot mint a second document.
create unique index if not exists atom_recovery_1440_invoice_unique
on public.invoices(invoice_number)
where invoice_number='INV-CORR-1440-000150';

create table if not exists public.atom_invoice_corrections (
 invoice_id uuid primary key references public.invoices(id),
 recovery_id uuid not null references public.atom_membership_recovery_1440(id),
 reason text not null,
 created_by uuid not null references public.profiles(user_id),
 created_at timestamptz not null default now()
);
alter table public.atom_membership_recovery_1440 enable row level security;
alter table public.atom_payment_voids enable row level security;
alter table public.atom_invoice_corrections enable row level security;
revoke all on public.atom_membership_recovery_1440,public.atom_payment_voids,public.atom_invoice_corrections from public,anon,authenticated;
grant select on public.atom_membership_recovery_1440,public.atom_payment_voids,public.atom_invoice_corrections to service_role;
grant insert on public.atom_membership_recovery_1440,public.atom_payment_voids,public.atom_invoice_corrections to service_role;

create or replace function public.atom_recovery_tables_immutable_v1()
returns trigger language plpgsql set search_path='public','pg_temp' as $immutable$
begin raise exception 'ATOM_RECOVERY_AUDIT_IMMUTABLE' using errcode='23514'; end $immutable$;
create trigger atom_recovery_immutable before update or delete on public.atom_membership_recovery_1440
 for each row execute function public.atom_recovery_tables_immutable_v1();
create trigger atom_payment_void_immutable before update or delete on public.atom_payment_voids
 for each row execute function public.atom_recovery_tables_immutable_v1();
create trigger atom_invoice_correction_immutable before update or delete on public.atom_invoice_corrections
 for each row execute function public.atom_recovery_tables_immutable_v1();

-- Payment source itself stays preserved for audit, but a voided receipt is NOT income.
-- Keep the source id and amount for the validated real Nov-23 EGP 2600 cash batch.
create or replace view public.admin_income_events_v1 as
select 'subscription_payment'::text as source_kind,
 sp.id as source_id,sp.subscription_id,sp.member_id,
 null::text as source_key,
 coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),
          p.email,p.member_id,'Subscription payment') as title,
 sp.note,
 sp.amount::numeric(12,2) as amount,
 normalize_payment_method(sp.payment_method) as payment_method_norm,
 sp.payment_method as payment_method_raw,
 coalesce(sp.paid_at,sp.created_at) as event_at,
 (coalesce(sp.paid_at,sp.created_at) at time zone 'Africa/Cairo')::date as business_date,
 sp.created_by,sp.created_at
from public.subscription_payments sp
left join public.profiles p on p.user_id=sp.member_id
where normalize_payment_method(sp.payment_method) = any(array['cash','instapay','card','bank_transfer']::text[])
and not exists(select 1 from public.atom_payment_voids v where v.payment_id=sp.id)
union all
select 'external_income'::text as source_kind,
 ei.id as source_id,null::uuid as subscription_id,null::uuid as member_id,
 ei.source_key,ei.title,ei.note,ei.amount,
 normalize_payment_method(ei.payment_method) as payment_method_norm,
 ei.payment_method as payment_method_raw,
 coalesce(ei.created_at,(ei.entry_date::timestamp at time zone 'Africa/Cairo')) as event_at,
 ei.entry_date as business_date,ei.created_by,ei.created_at
from public.external_income_entries ei
where ei.payment_method is not null
and normalize_payment_method(ei.payment_method) = any(array['cash','instapay','card','bank_transfer']::text[]);

create or replace function public.atom_correct_yasin_1440(
 p_actor uuid,
 p_apply boolean default false
) returns jsonb language plpgsql security definer set search_path='public','pg_temp'
as $repair$
declare
 c_member constant uuid := '18bed597-5f7e-4518-915f-0c5c5f8d0f05';
 c_old constant uuid := 'cb461683-0263-4f58-8079-8c41897ffd2a';
 c_wrong constant uuid := 'c3b74b46-11ff-4d67-a150-b0053598d2af';
 c_real constant uuid := 'c670b8df-a1da-4f28-99f5-ea837aa03724';
 c_false constant uuid := '83bcb8c2-fb96-4c95-8e95-9a65e79f7116';
 v_old public.subscriptions%rowtype;
 v_wrong public.subscriptions%rowtype;
 v_real public.subscription_payments%rowtype;
 v_false public.subscription_payments%rowtype;
 v_promo jsonb;
 v_credit numeric(12,2);
 v_due numeric(12,2);
 v_recovery_id uuid;
 v_upgrade_id uuid;
 v_new_start constant date:='2026-11-25';
 v_effective_end constant date:='2027-02-25';
 v_reason text:='Issue #1440: receptionist created advance 3m renewal instead of 1m->3m upgrade. 2600 EGP actual cash Nov 23 retained; 400 EGP Nov 24 fictitious entry voided. Partially paid upgrade with outstanding 1294.76 EGP. Original invoices preserved and superseded.';
begin
 if p_actor is null or (select role from public.profiles where user_id=p_actor) is distinct from 'super_admin'
 then raise exception 'SUPER_ADMIN_REQUIRED' using errcode='42501'; end if;
 if (now() at time zone 'Africa/Cairo')::date < v_new_start
    or (now() at time zone 'Africa/Cairo')::date >= '2026-12-03'
 then raise exception 'RECOVERY_WINDOW_EXPIRED_REVIEW_REQUIRED'; end if;
 if exists(select 1 from public.atom_membership_recovery_1440 where member_id=c_member) then
   if p_apply then return jsonb_build_object('ok',true,'alreadyApplied',true); end if;
   raise exception 'RECOVERY_ALREADY_APPLIED';
 end if;
 select * into v_old from public.subscriptions where id=c_old for update;
 select * into v_wrong from public.subscriptions where id=c_wrong for update;
 select * into v_real from public.subscription_payments where id=c_real for update;
 select * into v_false from public.subscription_payments where id=c_false for update;
 if v_old.id is null or v_wrong.id is null or v_real.id is null or v_false.id is null
   or v_old.member_id<>c_member or v_wrong.member_id<>c_member
   or v_old.status<>'active' or v_wrong.status<>'active'
   or v_old.plan<>'1m' or v_wrong.plan<>'3m'
   or v_old.start_date<>'2026-11-02' or v_old.end_date<>'2026-12-02'
   or v_wrong.start_date<>'2026-12-03' or v_wrong.end_date<>'2027-03-03'
   or v_old.amount<>2200 or v_wrong.amount<>3000 or v_wrong.amount_due<>0
   or v_real.subscription_id<>c_wrong or v_false.subscription_id<>c_wrong
   or v_real.member_id<>c_member or v_false.member_id<>c_member
   or v_real.amount<>2600 or v_false.amount<>400
   or v_real.payment_method<>'cash' or v_false.payment_method<>'cash'
   or (v_real.paid_at at time zone 'Africa/Cairo')::date<>'2026-11-23'
   or (v_false.paid_at at time zone 'Africa/Cairo')::date<>'2026-11-24'
 then raise exception 'RECOVERY_RECORDS_CHANGED_REQUIRE_REVIEW'; end if;
 if (select count(*) from public.subscription_payments where subscription_id=c_old)<>1
   or (select sum(amount) from public.subscription_payments where subscription_id=c_old)<>2200
   or (select count(*) from public.subscription_payments where subscription_id=c_wrong)<>2
   or (select sum(amount) from public.subscription_payments where subscription_id=c_wrong)<>3000
   or exists(select 1 from public.membership_upgrades where from_subscription_id=c_old or to_subscription_id=c_wrong)
   or exists(select 1 from public.membership_refunds where subscription_id in (c_old,c_wrong))
   or exists(select 1 from public.subscription_freezes where subscription_id in (c_old,c_wrong))
   or exists(select 1 from public.attendance where subscription_id in (c_old,c_wrong))
 then raise exception 'RECOVERY_LEDGER_OR_COVERAGE_HAS_CHANGED'; end if;
 if not exists(
   select 1 from public.payment_validation_batch_items i
   join public.payment_validation_batches b on b.id=i.batch_id
   where i.source_kind='subscription_payment' and i.source_id=c_real
      and i.amount_snapshot=2600 and i.business_date_snapshot='2026-11-23'
      and i.released_at is null and b.deleted_at is null and b.validated_at is not null
      and b.business_date='2026-11-23' and b.payment_method='cash'
 ) then raise exception 'REAL_PAYMENT_VALIDATED_BATCH_NOT_FOUND'; end if;
 if exists(select 1 from public.payment_validation_batch_items
   where source_kind='subscription_payment' and source_id=c_false and released_at is null)
 then raise exception 'FALSE_PAYMENT_HAS_VALIDATION_LOCK'; end if;
 if (select count(*) from public.invoices where subscription_id=c_wrong)<>2
   or not exists(select 1 from public.invoices where id='8471e07e-a590-42f0-a0f6-8f51a9a7a38b' and subscription_id=c_wrong and amount=3000)
   or not exists(select 1 from public.invoices where id='f3a2aec4-dc6a-4c0b-89f6-9c0ec0278a53' and subscription_id=c_wrong and amount=2600)
 then raise exception 'ORIGINAL_INVOICE_HISTORY_CHANGED'; end if;
 v_credit:=round(2200::numeric*8/31,2);
 v_promo:=public.membership_upgrade_promotion_price_v1('3m',v_new_start,5250);
 v_due:=(v_promo->>'finalPriceEGP')::numeric-v_credit;
 if v_credit<>567.74 or v_due<>3894.76 or v_due-2600<>1294.76
   or (v_promo->>'discountEGP')::numeric<>787.50 then
    raise exception 'FINANCIAL_CALCULATION_MISMATCH'; end if;

 if not p_apply then
   return jsonb_build_object('ok',true,'mode','preview','member','ATOM-000150',
     'effectiveDate',v_new_start,'endDate',v_effective_end,'listPriceEGP',5250,
     'discountEGP',787.50,'creditEGP',v_credit,'supplementDueEGP',v_due,
     'depositReceivedEGP',2600,'falseReceiptToVoidEGP',400,'outstandingEGP',1294.76,
     'realReceiptCashBusinessDate','2026-11-23','validatedCashBatchPreserved',true);
 end if;
 update public.subscriptions set status='cancelled' where id=c_old;
 update public.subscriptions set start_date=v_new_start,end_date=v_effective_end,
   amount=2600,amount_due=1294.76,paid_at=v_real.paid_at
 where id=c_wrong;
 insert into public.membership_upgrades(
   member_id,from_subscription_id,to_subscription_id,from_plan,to_plan,
   original_start_date,original_end_date,effective_date,payment_date,
   original_paid_egp,previously_carried_credit_egp,remaining_days,original_days,transferred_credit_egp,
   target_price_egp,additional_payment_egp,additional_payment_id,payment_method,
   receipt_attested,approved_by,approval_note,idempotency_key,request_fingerprint,
   target_list_price_egp,promotion_id,promotion_discount_egp,
   promotion_title_snapshot,promotion_discount_type_snapshot,promotion_discount_value_snapshot
 ) values (
   c_member,c_old,c_wrong,'1m','3m','2026-11-02','2026-12-02',v_new_start,'2026-11-23',
   2200,0,8,31,v_credit,(v_promo->>'finalPriceEGP')::numeric,2600,c_real,'cash',
   true,p_actor,v_reason,gen_random_uuid(),
   jsonb_build_object('recovery','ATOM-1440','from',c_old,'to',c_wrong,'realPayment',c_real,'falsePayment',c_false),
   5250,(v_promo->>'promotionId')::uuid,787.50,
   v_promo->>'promotionTitle',v_promo->>'discountType',(v_promo->>'discountValue')::numeric
 ) returning id into v_upgrade_id;
 insert into public.atom_membership_recovery_1440(
  member_id,original_subscription_id,corrected_subscription_id,real_payment_id,false_payment_id,
  upgrade_id,effective_date,original_old_subscription,original_wrong_subscription,false_receipt_snapshot,
  gross_target_price_egp,promotion_discount_egp,original_remaining_credit_egp,
  agreed_upgrade_supplement_egp,deposit_received_egp,outstanding_egp,created_by,reason
 ) values (
  c_member,c_old,c_wrong,c_real,c_false,v_upgrade_id,v_new_start,
  to_jsonb(v_old),to_jsonb(v_wrong),to_jsonb(v_false),
  5250,787.50,v_credit,v_due,2600,1294.76,p_actor,v_reason
 ) returning id into v_recovery_id;
 insert into public.atom_payment_voids(
   payment_id,recovery_id,member_id,voided_amount_egp,void_reason,created_by
 ) values(c_false,v_recovery_id,c_member,400,v_reason,p_actor);
 insert into public.atom_invoice_corrections(invoice_id,recovery_id,reason,created_by)
 select i.id,v_recovery_id,'Superseded by recovery #1440. Original PDF retained as historical document.',p_actor
 from public.invoices i where i.subscription_id=c_wrong;
 insert into public.audit_logs(actor_user_id,target_user_id,action,action_details)
 values (p_actor,c_member,'ATOM_1440_FINANCIAL_RECOVERY',jsonb_build_object(
   'recoveryId',v_recovery_id,'upgradeId',v_upgrade_id,'realReceipt',c_real,'falseReceipt',c_false,
   'previousSourceContract',to_jsonb(v_wrong),'currentStart',v_new_start,
   'currentEnd',v_effective_end,'cashCollected',2600,'newCashCollected',0,'remainingDue',1294.76));
 if (select count(*) from public.admin_income_events_v1 where source_kind='subscription_payment'
      and source_id in (c_real,c_false))<>1
    or not exists(select 1 from public.admin_income_events_v1
      where source_id=c_real and amount=2600 and business_date='2026-11-23')
    or (select count(*) from public.subscriptions where member_id=c_member and status='active')<>1
 then raise exception 'RECOVERY_FINANCIAL_POSTCHECK_FAILED'; end if;
 return jsonb_build_object('ok',true,'recoveryId',v_recovery_id,'upgradeId',v_upgrade_id,
   'realCashEGP',2600,'falseCashVoidedEGP',400,'outstandingEGP',1294.76,
   'needsCorrectiveInvoice',true);
end;
$repair$;
revoke all on function public.atom_correct_yasin_1440(uuid,boolean) from public,anon,authenticated;
grant execute on function public.atom_correct_yasin_1440(uuid,boolean) to service_role;
