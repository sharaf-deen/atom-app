-- ATOM Upgrade V1 hardening: no concurrent coverage, no archived member,
-- no retrospective ledger entry into an already validated daily payment batch.
-- Replace only the routine; the base migration has already been applied on Staging.
create or replace function public.apply_membership_upgrade_v1(
 p_from_subscription_id uuid,
 p_to_plan text,
 p_payment_date date,
 p_payment_method text,
 p_actor uuid,
 p_idempotency_key uuid,
 p_expected_credit numeric,
 p_expected_due numeric,
 p_receipt_attested boolean,
 p_bank_reference text default null,
 p_approval_note text default null
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_old public.subscriptions%rowtype;
 v_old_credit numeric(12,2):=0;
 v_cash numeric(12,2):=0;
 v_total_paid numeric(12,2):=0;
 v_price numeric(12,2);
 v_pkg_count integer;
 v_days integer;
 v_left integer;
 v_credit numeric(12,2);
 v_due numeric(12,2);
 v_today date:=(now() at time zone 'Africa/Cairo')::date;
 v_end date;
 v_new_id uuid;
 v_payment_id uuid;
 v_upgrade_id uuid;
 v_existing public.membership_upgrades%rowtype;
 v_fingerprint jsonb;
 v_role text;
 v_source_order integer;
 v_target_order integer;
begin
 if p_actor is null or p_idempotency_key is null or p_from_subscription_id is null then
   raise exception 'MISSING_REQUIRED_INPUT' using errcode='22023';
 end if;
 select role into v_role from public.profiles where user_id=p_actor;
 if v_role is distinct from 'super_admin' then raise exception 'SUPER_ADMIN_REQUIRED' using errcode='42501'; end if;
 if p_to_plan not in ('1w','1m','3m','6m','12m')
   or p_payment_method not in ('cash','instapay','card','bank_transfer') then
   raise exception 'INVALID_PLAN_OR_PAYMENT_METHOD' using errcode='22023';
 end if;
 if p_payment_date is null or p_payment_date>v_today then
   raise exception 'INVALID_PAYMENT_DATE' using errcode='22023';
 end if;
 if p_expected_credit is null or p_expected_due is null or
    p_expected_credit<0 or p_expected_due<0 then
   raise exception 'EXPECTED_AMOUNTS_REQUIRED' using errcode='22023';
 end if;
 if p_receipt_attested is distinct from true then raise exception 'RECEIPT_ATTESTATION_REQUIRED' using errcode='22023'; end if;
 if p_payment_method in ('instapay','bank_transfer') and length(trim(coalesce(p_bank_reference,'')))<3 then
   raise exception 'BANK_REFERENCE_REQUIRED' using errcode='22023';
 end if;
 v_fingerprint=jsonb_build_object('old',p_from_subscription_id,'target',p_to_plan,
  'payment_date',p_payment_date,'method',p_payment_method,'expected_credit',p_expected_credit,
  'expected_due',p_expected_due,'bank_ref',coalesce(trim(p_bank_reference),''),'note',coalesce(trim(p_approval_note),''));
 select * into v_existing from public.membership_upgrades where idempotency_key=p_idempotency_key;
 if found then
   if v_existing.request_fingerprint<>v_fingerprint or v_existing.approved_by<>p_actor then
     raise exception 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD' using errcode='23505';
   end if;
   return jsonb_build_object('ok',true,'already_applied',true,'upgrade_id',v_existing.id,
     'subscription_id',v_existing.to_subscription_id,'payment_id',v_existing.additional_payment_id);
 end if;
 select * into v_old from public.subscriptions where id=p_from_subscription_id for update;
 if not found then raise exception 'SUBSCRIPTION_NOT_FOUND' using errcode='P0002'; end if;
 -- Re-check after row lock: a concurrent request may have just committed with this key.
 select * into v_existing from public.membership_upgrades where idempotency_key=p_idempotency_key;
 if found then
   if v_existing.request_fingerprint<>v_fingerprint or v_existing.approved_by<>p_actor then
     raise exception 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD' using errcode='23505';
   end if;
   return jsonb_build_object('ok',true,'already_applied',true,'upgrade_id',v_existing.id,
     'subscription_id',v_existing.to_subscription_id,'payment_id',v_existing.additional_payment_id);
 end if;
 if v_old.status<>'active' or v_old.subscription_type<>'time'
   or v_old.start_date>v_today or v_old.end_date<v_today then
   raise exception 'SUBSCRIPTION_NOT_ACTIVE' using errcode='23514';
 end if;
 v_source_order=array_position(array['1w','1m','3m','6m','12m'],v_old.plan);
 v_target_order=array_position(array['1w','1m','3m','6m','12m'],p_to_plan);
 if v_source_order is null or v_target_order is null or v_target_order<=v_source_order then
   raise exception 'TARGET_MUST_BE_HIGHER' using errcode='23514';
 end if;
 if coalesce(v_old.amount_due,0)<>0 then
   raise exception 'OLD_SUBSCRIPTION_HAS_DUES' using errcode='23514';
 end if;
 if (v_old.frozen_until is not null and v_old.frozen_until>=v_today)
   or exists(select 1 from public.subscription_freezes where subscription_id=v_old.id and cleared_at is null) then
   raise exception 'FROZEN_SUBSCRIPTION_REQUIRES_REVIEW' using errcode='23514';
 end if;
 if exists(select 1 from public.membership_refunds
   where subscription_id=v_old.id and status not in ('rejected','cancelled')) then
   raise exception 'EXISTING_REFUND_REQUIRES_REVIEW' using errcode='23514';
 end if;
 if exists(select 1 from public.membership_renewal_requests
   where member_id=v_old.member_id and status not in ('completed','rejected','cancelled')) then
   raise exception 'OPEN_RENEWAL_REQUEST_REQUIRES_REVIEW' using errcode='23514';
 end if;
 if exists(select 1 from public.subscriptions s where s.member_id=v_old.member_id
   and s.id<>v_old.id and s.status='active'
   and (s.end_date is null or s.end_date>=v_today)) then
   raise exception 'OTHER_ACTIVE_OR_SCHEDULED_SUBSCRIPTION_REQUIRES_REVIEW' using errcode='23514';
 end if;
 if exists(select 1 from public.profiles p where p.user_id=v_old.member_id and p.archived_at is not null) then
   raise exception 'ARCHIVED_MEMBER_REQUIRES_REVIEW' using errcode='23514';
 end if;
  if exists(select 1 from public.membership_upgrades where from_subscription_id=v_old.id) then
   raise exception 'ALREADY_UPGRADED' using errcode='23505';
 end if;
 select coalesce(sum(amount),0)::numeric(12,2) into v_cash
   from public.subscription_payments where subscription_id=v_old.id;
 if abs(v_cash-coalesce(v_old.amount,0))>0.01 then
   raise exception 'PAYMENT_LEDGER_MISMATCH' using errcode='23514';
 end if;
 select coalesce(transferred_credit_egp,0) into v_old_credit
   from public.membership_upgrades where to_subscription_id=v_old.id;
 v_old_credit:=coalesce(v_old_credit,0);
 v_total_paid:=v_cash+v_old_credit;
 v_days:=v_old.end_date-v_old.start_date+1;
 v_left:=v_old.end_date-v_today+1;
 if v_days<=0 or v_left<=0 or v_left>v_days then
   raise exception 'INVALID_COVERAGE' using errcode='23514';
 end if;
 v_credit:=round(v_total_paid*v_left/v_days,2);
 select count(*),max(price_egp) into v_pkg_count,v_price from public.packages_pricing
   where type='membership' and is_active=true
   and ((p_to_plan='1w' and unit='week' and qty=1)
     or (p_to_plan<>'1w' and unit='month' and qty=case p_to_plan
       when '1m' then 1 when '3m' then 3 when '6m' then 6 when '12m' then 12 else 0 end));
 if v_pkg_count<>1 or v_price is null or v_price<0 then
   raise exception 'PRICE_NOT_UNIQUE_OR_UNAVAILABLE' using errcode='23514';
 end if;
 if v_credit>v_price then raise exception 'CREDIT_EXCEEDS_PLAN_PRICE' using errcode='23514'; end if;
 v_due:=round(v_price-v_credit,2);
 if abs(v_credit-p_expected_credit)>0.01 or abs(v_due-p_expected_due)>0.01 then
   raise exception 'QUOTE_STALE_RECALCULATE' using errcode='23514';
 end if;
 -- Do not silently append a backdated receipt into an already validated daily
 -- batch: explicitly reopen/revalidate the original business date first.
 if v_due>0 and exists(
   select 1 from public.payment_validation_batches b
   where b.payment_method=p_payment_method and b.business_date=p_payment_date
    and b.validation_mode='daily' and b.validated_at is not null
    and b.deleted_at is null
 ) then
   raise exception 'PAYMENT_DATE_ALREADY_VALIDATED_REQUIRES_RECONCILIATION' using errcode='23514';
 end if;
  v_end:=case p_to_plan
   when '1w' then v_today+6
   when '1m' then (v_today+interval '1 month')::date
   when '3m' then (v_today+interval '3 months')::date
   when '6m' then (v_today+interval '6 months')::date
   when '12m' then (v_today+interval '12 months')::date
   else null end;
 -- Preserve old contracted dates and every historical payment; cancellation ends its active coverage.
 update public.subscriptions set status='cancelled' where id=v_old.id;
 insert into public.subscriptions(member_id,subscription_type,plan,start_date,end_date,status,amount,amount_due,
  payment_method,paid_at)
 values(v_old.member_id,'time',p_to_plan,v_today,v_end,'active',v_due,0,p_payment_method,
   case when v_due>0 then (p_payment_date::timestamp+interval '12 hours') at time zone 'UTC' else null end)
 returning id into v_new_id;
 if v_due>0 then
   insert into public.subscription_payments(subscription_id,member_id,amount,payment_method,note,created_by,paid_at)
   values(v_new_id,v_old.member_id,v_due,p_payment_method,
      'Membership upgrade; old subscription '||v_old.id||'; bank reference: '||coalesce(trim(p_bank_reference),''),
      p_actor,(p_payment_date::timestamp+interval '12 hours') at time zone 'UTC')
   returning id into v_payment_id;
 end if;
 insert into public.membership_upgrades(member_id,from_subscription_id,to_subscription_id,
  from_plan,to_plan,original_start_date,original_end_date,effective_date,payment_date,
  original_paid_egp,previously_carried_credit_egp,remaining_days,original_days,transferred_credit_egp,
  target_price_egp,additional_payment_egp,additional_payment_id,payment_method,
  bank_reference,receipt_attested,approved_by,approval_note,idempotency_key,request_fingerprint)
 values(v_old.member_id,v_old.id,v_new_id,v_old.plan,p_to_plan,v_old.start_date,v_old.end_date,v_today,p_payment_date,
  v_cash,v_old_credit,v_left,v_days,v_credit,v_price,v_due,v_payment_id,p_payment_method,
  nullif(trim(p_bank_reference),''),true,p_actor,nullif(trim(p_approval_note),''),p_idempotency_key,v_fingerprint)
 returning id into v_upgrade_id;
 return jsonb_build_object('ok',true,'already_applied',false,'upgrade_id',v_upgrade_id,
  'subscription_id',v_new_id,'payment_id',v_payment_id,'credit_egp',v_credit,
  'payment_amount_egp',v_due,'effective_date',v_today,'payment_date',p_payment_date);
end $$;
revoke all on function public.apply_membership_upgrade_v1(uuid,text,date,text,uuid,uuid,numeric,numeric,boolean,text,text)
 from public,anon,authenticated;
grant execute on function public.apply_membership_upgrade_v1(uuid,text,date,text,uuid,uuid,numeric,numeric,boolean,text,text)
 to service_role;

