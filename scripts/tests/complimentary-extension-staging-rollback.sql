-- ATOM #1430 rollback-only Staging integration regression.
-- REQUIRES seeded Staging fixture with Super Admin and active time subscription.
-- NEVER run against Production. All writes are intentionally rolled back.
begin;
do $test$
declare
 s public.subscriptions%rowtype;
 actor uuid;
 outsider uuid;
 key_a uuid:=gen_random_uuid();
 key_b uuid:=gen_random_uuid();
 gift_a uuid;
 gift_b uuid;
 result jsonb;
 baseline_payments bigint;
 baseline_invoices bigint;
 baseline_refunds bigint;
 baseline_amount numeric;
 baseline_due numeric;
 denied boolean;
begin
 select user_id into actor from public.profiles where role='super_admin' limit 1;
 select user_id into outsider from public.profiles where role='reception' limit 1;
 if actor is null or outsider is null then raise exception 'STAGING_FIXTURES_MISSING'; end if;
 select * into s from public.subscriptions x where x.status='active'
   and x.subscription_type='time' and x.start_date is not null
   and x.end_date >= (now() at time zone 'Africa/Cairo')::date
   and not exists(select 1 from public.membership_refunds mr where mr.subscription_id=x.id
      and mr.status not in ('rejected','cancelled'))
   order by x.end_date desc limit 1 for update;
 if s.id is null then raise exception 'STAGING_ELIGIBLE_SUBSCRIPTION_MISSING'; end if;
 select count(*) into baseline_payments from public.subscription_payments where subscription_id=s.id;
 select count(*) into baseline_invoices from public.invoices where subscription_id=s.id;
 select count(*) into baseline_refunds from public.membership_refunds where subscription_id=s.id;
 baseline_amount:=s.amount; baseline_due:=s.amount_due;
 result:=public.atom_grant_complimentary_days_v1(s.id,7,'Goodwill gesture','rollback-only QA',actor,key_a);
 gift_a:=(result->>'grant_id')::uuid;
 if result->>'already_applied'<>'false' then raise exception 'GRANT_FAIL'; end if;
 perform 1 from public.subscriptions where id=s.id and end_date=s.end_date+7 and paid_end_date=s.end_date;
 if not found then raise exception 'ACCESS_VS_PAID_END_FAIL'; end if;
 result:=public.atom_grant_complimentary_days_v1(s.id,7,'Goodwill gesture','rollback-only QA',actor,key_a);
 if result->>'already_applied'<>'true' then raise exception 'RETRY_IDEMPOTENCY_FAIL'; end if;
 result:=public.atom_grant_complimentary_days_v1(s.id,3,'Loyalty reward',null,actor,key_b);
 gift_b:=(result->>'grant_id')::uuid;
 perform 1 from public.subscriptions where id=s.id and end_date=s.end_date+10 and paid_end_date=s.end_date;
 if not found then raise exception 'CUMULATIVE_GRANTS_FAIL'; end if;
 denied:=false;
 begin
   perform public.atom_grant_complimentary_days_v1(s.id,1,'Goodwill gesture',null,outsider,gen_random_uuid());
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'ROLE_BYPASS'; end if;
 denied:=false;
 begin
   update public.subscriptions set paid_end_date=null where id=s.id;
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'PAID_END_MUTATION_BYPASS'; end if;
 denied:=false;
 begin
   update public.subscription_complimentary_extensions set reason='tampered' where id=gift_a;
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'AUDIT_HISTORY_MUTATION_BYPASS'; end if;
 result:=public.atom_reverse_complimentary_days_v1(gift_a,actor,'Rollback QA');
 perform 1 from public.subscriptions where id=s.id and end_date=s.end_date+3 and paid_end_date=s.end_date;
 if not found then raise exception 'INTERVENING_GRANT_REVERSAL_FAIL'; end if;
 result:=public.atom_reverse_complimentary_days_v1(gift_b,actor,'Rollback QA');
 if result->>'already_reversed'<>'false' then raise exception 'REVERSAL_FAILED'; end if;
 perform 1 from public.subscriptions where id=s.id and end_date=s.end_date
   and paid_end_date=s.end_date
   and amount is not distinct from baseline_amount
   and amount_due is not distinct from baseline_due;
 if not found then raise exception 'RESTORE_FAILED'; end if;
 if (select count(*) from public.subscription_payments where subscription_id=s.id)<>baseline_payments
 or (select count(*) from public.invoices where subscription_id=s.id)<>baseline_invoices
 or (select count(*) from public.membership_refunds where subscription_id=s.id)<>baseline_refunds then
   raise exception 'FINANCIAL_LEDGER_SIDE_EFFECT';
 end if;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='apply_membership_upgrade_v1'
   and position('v_days:=coalesce(v_old.paid_end_date,v_old.end_date)' in pg_get_functiondef(p.oid))>0) then
   raise exception 'UPGRADE_PAID_END_NOT_PATCHED'; end if;
 if has_function_privilege('authenticated',
     'public.atom_grant_complimentary_days_v1(uuid,integer,text,text,uuid,uuid)','EXECUTE') then
   raise exception 'PUBLIC_GRANT_RPC_ACCESS'; end if;
 raise notice 'ALL ROLLBACK-ONLY COMPLIMENTARY GRANT GUARDS PASSED';
end $test$;
rollback;
