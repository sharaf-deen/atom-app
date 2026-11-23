-- ATOM #1430: complimentary membership extension, not paid credit.
-- IMPORTANT: materialised subscriptions.end_date remains access coverage.
-- paid_end_date snapshots only the financial coverage and tracks non-gift end changes.
alter table public.subscriptions add column if not exists paid_end_date date;
comment on column public.subscriptions.paid_end_date is 'Commercial entitlement end for memberships receiving complimentary days; NULL means same as end_date. Financial proration must use coalesce(paid_end_date,end_date).';

create table if not exists public.subscription_complimentary_extensions (
 id uuid primary key default gen_random_uuid(),
 subscription_id uuid not null references public.subscriptions(id),
 request_key uuid not null unique,
 days integer not null check (days between 1 and 365),
 reason text not null check (length(btrim(reason)) between 3 and 200),
 internal_note text,
 granted_by uuid not null references public.profiles(user_id),
 granted_at timestamptz not null default now(),
 previous_end_date date not null,
 resulting_end_date date not null,
 reversed_at timestamptz,
 reversed_by uuid references public.profiles(user_id),
 reversal_reason text,
 constraint complimentary_reversal_complete check (
  (reversed_at is null and reversed_by is null and reversal_reason is null)
  or (reversed_at is not null and reversed_by is not null and length(btrim(reversal_reason)) >= 3)
 )
);
create index if not exists subscription_complimentary_extensions_by_subscription
 on public.subscription_complimentary_extensions(subscription_id,granted_at desc);
alter table public.subscription_complimentary_extensions enable row level security;
revoke all on public.subscription_complimentary_extensions from public,anon,authenticated;
grant select,insert,update on public.subscription_complimentary_extensions to service_role;

-- Other existing contract changes (freeze, refund shortening) adjust BOTH coverage bases
-- by the same calendar-day delta. Complimentary grant and reversal change access only.
create or replace function public.atom_preserve_paid_membership_coverage_v1()
returns trigger language plpgsql set search_path = 'public', 'pg_temp' as $$
begin
 if new.end_date is distinct from old.end_date and old.paid_end_date is not null
    and coalesce(current_setting('atom.complimentary_extension_operation',true),'') <> '1'
 then
   new.paid_end_date := old.paid_end_date + (new.end_date - old.end_date);
 end if;
 if new.paid_end_date is not null and new.end_date is not null and new.paid_end_date > new.end_date then
   raise exception 'PAID_END_EXCEEDS_ACCESS_END' using errcode='23514';
 end if;
 return new;
end $$;
drop trigger if exists atom_subscription_paid_end_guard_v1 on public.subscriptions;
create trigger atom_subscription_paid_end_guard_v1
 before update on public.subscriptions for each row
 execute function public.atom_preserve_paid_membership_coverage_v1();

create or replace function public.atom_grant_complimentary_days_v1(
 p_subscription_id uuid,p_days integer,p_reason text,p_note text,p_actor uuid,p_request_key uuid
) returns jsonb
language plpgsql security definer set search_path = 'public','pg_temp' as $$
declare s public.subscriptions%rowtype; existing public.subscription_complimentary_extensions%rowtype; new_end date;
begin
 if p_actor is null or not exists(select 1 from public.profiles where user_id=p_actor and role='super_admin') then
   raise exception 'SUPER_ADMIN_REQUIRED' using errcode='42501';
 end if;
 if p_days is null or p_days < 1 or p_days > 365 or p_request_key is null
    or p_reason is null or length(btrim(p_reason)) not between 3 and 200
    or length(coalesce(p_note,''))>2000 then
   raise exception 'INVALID_COMPLIMENTARY_EXTENSION' using errcode='22023';
 end if;
 -- Lock subscription first to serialize competing grant, freeze and refund modifications.
 select * into s from public.subscriptions where id=p_subscription_id for update;
 if not found then raise exception 'SUBSCRIPTION_NOT_FOUND' using errcode='P0002'; end if;
 select * into existing from public.subscription_complimentary_extensions where request_key=p_request_key;
 if found then
   if existing.subscription_id<>p_subscription_id or existing.days<>p_days
      or existing.reason<>btrim(p_reason) or coalesce(existing.internal_note,'')<>coalesce(p_note,'')
      or existing.granted_by<>p_actor then
     raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='23505';
   end if;
   return jsonb_build_object('ok',true,'already_applied',true,'grant_id',existing.id,'end_date',existing.resulting_end_date);
 end if;
 if s.subscription_type<>'time' or s.status<>'active' or s.end_date is null
    or s.start_date is null or s.end_date < (now() at time zone 'Africa/Cairo')::date then
   raise exception 'SUBSCRIPTION_NOT_ELIGIBLE' using errcode='23514';
 end if;
 if exists(select 1 from public.membership_refunds where subscription_id=s.id
  and status not in ('rejected','cancelled')) then
   raise exception 'REFUND_REVIEW_REQUIRED' using errcode='23514';
 end if;
 new_end:=s.end_date+p_days;
 perform set_config('atom.complimentary_extension_operation','1',true);
 update public.subscriptions
   set paid_end_date=coalesce(paid_end_date,end_date),end_date=new_end
   where id=s.id;
 perform set_config('atom.complimentary_extension_operation','',true);
 insert into public.subscription_complimentary_extensions
   (subscription_id,request_key,days,reason,internal_note,granted_by,previous_end_date,resulting_end_date)
   values(s.id,p_request_key,p_days,btrim(p_reason),p_note,p_actor,s.end_date,new_end)
   returning * into existing;
 return jsonb_build_object('ok',true,'already_applied',false,'grant_id',existing.id,
  'previous_end_date',s.end_date,'end_date',new_end,'paid_end_date',coalesce(s.paid_end_date,s.end_date));
end $$;

create or replace function public.atom_reverse_complimentary_days_v1(
 p_grant_id uuid,p_actor uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare e public.subscription_complimentary_extensions%rowtype; s public.subscriptions%rowtype;
begin
 if p_actor is null or not exists(select 1 from public.profiles where user_id=p_actor and role='super_admin') then
   raise exception 'SUPER_ADMIN_REQUIRED' using errcode='42501';
 end if;
 if p_reason is null or length(btrim(p_reason))<3 or length(p_reason)>2000 then
   raise exception 'REVERSAL_REASON_REQUIRED' using errcode='22023';
 end if;
 select * into e from public.subscription_complimentary_extensions where id=p_grant_id;
 if not found then raise exception 'GRANT_NOT_FOUND' using errcode='P0002'; end if;
 select * into s from public.subscriptions where id=e.subscription_id for update;
 select * into e from public.subscription_complimentary_extensions where id=p_grant_id for update;
 if e.reversed_at is not null then
   return jsonb_build_object('ok',true,'already_reversed',true,'end_date',s.end_date);
 end if;
 if s.status<>'active' or s.end_date is null or s.paid_end_date is null
    or s.end_date-e.days<s.paid_end_date or s.end_date-e.days<(now() at time zone 'Africa/Cairo')::date
    or exists(select 1 from public.membership_upgrades where from_subscription_id=s.id)
    or exists(select 1 from public.membership_refunds where subscription_id=s.id and status not in ('rejected','cancelled')) then
   raise exception 'REVERSAL_REQUIRES_REVIEW' using errcode='23514';
 end if;
 perform set_config('atom.complimentary_extension_operation','1',true);
 update public.subscriptions set end_date=s.end_date-e.days where id=s.id;
 perform set_config('atom.complimentary_extension_operation','',true);
 update public.subscription_complimentary_extensions set reversed_at=now(),reversed_by=p_actor,
   reversal_reason=btrim(p_reason) where id=e.id;
 return jsonb_build_object('ok',true,'already_reversed',false,'end_date',s.end_date-e.days);
end $$;

revoke all on function public.atom_grant_complimentary_days_v1(uuid,integer,text,text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.atom_reverse_complimentary_days_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.atom_grant_complimentary_days_v1(uuid,integer,text,text,uuid,uuid) to service_role;
grant execute on function public.atom_reverse_complimentary_days_v1(uuid,uuid,text) to service_role;

-- Existing upgrade calculation MUST use paid basis, not complimentary access expiry.
CREATE OR REPLACE FUNCTION public.apply_membership_upgrade_v1(p_from_subscription_id uuid, p_to_plan text, p_payment_date date, p_payment_method text, p_actor uuid, p_idempotency_key uuid, p_expected_credit numeric, p_expected_due numeric, p_receipt_attested boolean, p_bank_reference text DEFAULT NULL::text, p_approval_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
 v_days:=coalesce(v_old.paid_end_date,v_old.end_date)-v_old.start_date+1;
 v_left:=coalesce(v_old.paid_end_date,v_old.end_date)-v_today+1;
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
   where b.payment_method=p_payment_method and b.validated_at is not null
    and b.deleted_at is null
    and (
       (b.validation_mode='daily' and b.business_date=p_payment_date)
       or (b.validation_mode='cash_period'
         and p_payment_date between
             (b.period_from at time zone 'Africa/Cairo')::date
             and (b.period_to at time zone 'Africa/Cairo')::date)
    )
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
 values(v_old.member_id,v_old.id,v_new_id,v_old.plan,p_to_plan,v_old.start_date,coalesce(v_old.paid_end_date,v_old.end_date),v_today,p_payment_date,
  v_cash,v_old_credit,v_left,v_days,v_credit,v_price,v_due,v_payment_id,p_payment_method,
  nullif(trim(p_bank_reference),''),true,p_actor,nullif(trim(p_approval_note),''),p_idempotency_key,v_fingerprint)
 returning id into v_upgrade_id;
 return jsonb_build_object('ok',true,'already_applied',false,'upgrade_id',v_upgrade_id,
  'subscription_id',v_new_id,'payment_id',v_payment_id,'credit_egp',v_credit,
  'payment_amount_egp',v_due,'effective_date',v_today,'payment_date',p_payment_date);
end $function$
;
