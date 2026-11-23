-- ATOM #1430: Staging-only end-to-end paid-upgrade + donated-day carryover test.
-- Run in Staging with seeded Super Admin and a member without active subscriptions.
-- All fixture mutations are rolled back. Never run in Production.
begin;
do $qa$
declare
 actor uuid; member uuid; sid uuid; nid uuid;
 today date:=(now() at time zone 'Africa/Cairo')::date;
 price_1m numeric; price_12m numeric; expected_credit numeric;
 r jsonb; n public.subscriptions%rowtype;
begin
 select user_id into actor from public.profiles where role='super_admin' limit 1;
 select p.user_id into member from public.profiles p
   where p.role='member' and not exists(
     select 1 from public.subscriptions s where s.member_id=p.user_id and s.status='active')
   order by p.user_id limit 1;
 if actor is null or member is null then raise exception 'STAGING_FIXTURE_MISSING'; end if;
 select price_egp into strict price_1m from public.packages_pricing
   where type='membership' and unit='month' and qty=1 and is_active=true;
 select price_egp into strict price_12m from public.packages_pricing
   where type='membership' and unit='month' and qty=12 and is_active=true;
 insert into public.subscriptions
  (member_id,subscription_type,plan,start_date,end_date,status,amount,amount_due,payment_method)
  values(member,'time','1m',today-5,today+25,'active',price_1m,0,'cash') returning id into sid;
 insert into public.subscription_payments(subscription_id,member_id,amount,payment_method,created_by,paid_at)
  values(sid,member,price_1m,'cash',actor,now());
 perform public.atom_grant_complimentary_days_v1(sid,10,'Goodwill gesture',null,actor,gen_random_uuid());
 expected_credit:=round(price_1m*26/31,2);
 r:=public.apply_membership_upgrade_v1(sid,'12m',today,'cash',actor,gen_random_uuid(),
    expected_credit,round(price_12m-expected_credit,2),true,null,
    'Complimentary extension upgrade regression');
 if r->>'ok'<>'true' or abs((r->>'credit_egp')::numeric-expected_credit)>0.01 then
    raise exception 'COMPLIMENTARY_DAYS_MONETIZED_OR_UPGRADE_FAILED: %',r; end if;
 nid:=(r->>'subscription_id')::uuid;
 select * into n from public.subscriptions where id=nid;
 if n.end_date-n.paid_end_date<>10 then raise exception 'GIFT_DAYS_NOT_CARRIED'; end if;
 if not exists(select 1 from public.subscription_complimentary_extensions
    where subscription_id=nid and transfer_from_subscription_id=sid and days=10 and reversed_at is null)
 then raise exception 'UPGRADE_TRANSFER_AUDIT_MISSING'; end if;
 if not exists(select 1 from public.subscriptions where id=sid and status='cancelled')
 then raise exception 'ORIGINAL_SUBSCRIPTION_NOT_CLOSED'; end if;
 raise notice 'UPGRADE CREDIT EXCLUDES GIFT, GIFT CARRIES OVER, IMMUTABLE AUDIT OK';
end $qa$;
rollback;
