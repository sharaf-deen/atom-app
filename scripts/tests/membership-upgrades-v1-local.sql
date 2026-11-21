-- ATOM Membership Upgrades V1: isolated transactional financial acceptance.
-- Local CI and Supabase Staging only. All fake users/receipts/upgrades ROLLBACK.
\set ON_ERROR_STOP on
BEGIN;
DO $tests$
DECLARE
  v_actor uuid := '18f0a1b2-2c3d-4e5f-8a9b-000000000001';
  v_member uuid := '18f0a1b2-2c3d-4e5f-8a9b-000000000002';
  v_other uuid := '18f0a1b2-2c3d-4e5f-8a9b-000000000003';
  v_day date := (now() at time zone 'Africa/Cairo')::date;
  v_old uuid;
  v_new uuid;
  v_newest uuid;
  v_payment uuid;
  v_key uuid := gen_random_uuid();
  v_result jsonb;
  v_repeat jsonb;
  v_blocked boolean;
  v_code text;
  v_batch uuid;
  v_count integer;
  v_count_before integer;
  v_amount numeric;
  v_paydate date;
  v_credit numeric;
  v_newprice numeric;
  v_nextdue numeric;
BEGIN
 INSERT INTO auth.users
  (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
 VALUES
  ('00000000-0000-0000-0000-000000000000',v_actor,'authenticated','authenticated','upgrade_test_admin@example.invalid','not-a-login',now(),now(),now()),
  ('00000000-0000-0000-0000-000000000000',v_member,'authenticated','authenticated','upgrade_test_member@example.invalid','not-a-login',now(),now(),now()),
  ('00000000-0000-0000-0000-000000000000',v_other,'authenticated','authenticated','upgrade_test_other@example.invalid','not-a-login',now(),now(),now());
 INSERT INTO public.profiles(user_id,email,role)
 VALUES
  (v_actor,'upgrade_test_admin@example.invalid','super_admin'),
  (v_member,'upgrade_test_member@example.invalid','member'),
  (v_other,'upgrade_test_other@example.invalid','member')
 ON CONFLICT (user_id) DO UPDATE SET role=excluded.role;
 IF to_regclass('public.membership_upgrades') is null then raise exception 'UPGRADES_TABLE_MISSING'; end if;
 IF not (SELECT relrowsecurity FROM pg_class WHERE oid='public.membership_upgrades'::regclass)
   THEN raise exception 'UPGRADE_RLS_DISABLED'; end if;
 IF has_table_privilege('authenticated','public.membership_upgrades','INSERT')
   OR has_table_privilege('anon','public.membership_upgrades','SELECT')
   OR has_function_privilege('authenticated',
      'public.apply_membership_upgrade_v1(uuid,text,date,text,uuid,uuid,numeric,numeric,boolean,text,text)',
      'EXECUTE')
   THEN raise exception 'UPGRADE_RLS_OR_PRIVILEGE_LEAK'; end if;

 INSERT INTO public.subscriptions(member_id,subscription_type,plan,status,start_date,end_date,amount,amount_due,payment_method)
 VALUES(v_member,'time','1m','active',v_day-20,v_day+9,2200,0,'cash')
 RETURNING id INTO v_old;
 INSERT INTO public.subscription_payments(subscription_id,member_id,amount,payment_method,paid_at,note,created_by)
 VALUES(v_old,v_member,2200,'cash',now()-interval '20 days','rollback only initial payment',v_actor);

 -- Not authorized: real member role cannot approve even when using a privileged SQL connection.
 v_blocked:=false;
 BEGIN
  PERFORM public.apply_membership_upgrade_v1(v_old,'3m',v_day-5,'instapay',v_member,gen_random_uuid(),
    733.33,4516.67,true,'fictional-no-bank-match-001','test');
 EXCEPTION WHEN SQLSTATE '42501' THEN v_blocked:=true;
 END;
 IF NOT v_blocked THEN raise exception 'NON_ADMIN_ALLOWED_UPGRADE'; end if;

 -- Reject a stale/malicious client quote without any new subscription or receipt.
 v_blocked:=false;
 BEGIN
  PERFORM public.apply_membership_upgrade_v1(v_old,'3m',v_day-5,'instapay',v_actor,gen_random_uuid(),
    733.33,100,true,'fictional-no-bank-match-002','test');
 EXCEPTION WHEN SQLSTATE '23514' THEN v_blocked:=true;
 END;
 IF NOT v_blocked OR EXISTS (SELECT 1 FROM public.membership_upgrades WHERE from_subscription_id=v_old)
    OR (SELECT status FROM public.subscriptions WHERE id=v_old)<>'active'
   THEN raise exception 'STALE_QUOTE_GUARD_FAILED'; end if;

 -- Successful historic-date payment; no backdating membership effective date.
 v_result:=public.apply_membership_upgrade_v1(v_old,'3m',v_day-5,'instapay',v_actor,v_key,
    733.33,4516.67,true,'fictional-no-bank-match-003','staging rollback');
 v_new:=(v_result->>'subscription_id')::uuid;
 v_payment:=(v_result->>'payment_id')::uuid;
 IF v_result->>'ok'<>'true' OR (v_result->>'already_applied')::boolean is not false THEN
  raise exception 'UPGRADE_RESULT_INVALID'; end if;
 IF (SELECT status FROM public.subscriptions WHERE id=v_old)<>'cancelled' OR
    (SELECT end_date FROM public.subscriptions WHERE id=v_old)<>v_day+9 OR
    (SELECT start_date FROM public.subscriptions WHERE id=v_new)<>v_day OR
    (SELECT status FROM public.subscriptions WHERE id=v_new)<>'active'
   THEN raise exception 'PLAN_DATE_OR_STATUS_INVARIANT_FAILED'; end if;
 IF (SELECT amount FROM public.subscription_payments WHERE id=v_payment)<>4516.67 OR
    (SELECT (paid_at at time zone 'Africa/Cairo')::date FROM public.subscription_payments WHERE id=v_payment)<>v_day-5 OR
    (SELECT amount FROM public.subscriptions WHERE id=v_new)<>4516.67 OR
    (SELECT amount_due FROM public.subscriptions WHERE id=v_new)<>0
   THEN raise exception 'PAST_PAYMENT_DATE_OR_LEDGER_MISMATCH'; end if;
 IF (SELECT transferred_credit_egp FROM public.membership_upgrades WHERE to_subscription_id=v_new)<>733.33
   THEN raise exception 'TRANSFERRED_CREDIT_WRONG'; end if;
 SELECT sum(amount) INTO v_amount FROM public.subscription_payments WHERE subscription_id IN(v_old,v_new);
 IF v_amount<>6716.67 THEN raise exception 'DUPLICATED_CREDIT_AS_CASH %',v_amount; end if;

 -- Same idempotency key must return same result without a second entry.
 v_repeat:=public.apply_membership_upgrade_v1(v_old,'3m',v_day-5,'instapay',v_actor,v_key,
    733.33,4516.67,true,'fictional-no-bank-match-003','staging rollback');
 IF (v_repeat->>'already_applied')::boolean IS DISTINCT FROM true OR
    (v_repeat->>'subscription_id')::uuid<>v_new OR
    (SELECT count(*) FROM public.membership_upgrades WHERE from_subscription_id=v_old)<>1
   THEN raise exception 'IDEMPOTENT_RETRY_FAILED'; end if;

 v_blocked:=false;
 BEGIN
  PERFORM public.apply_membership_upgrade_v1(v_old,'3m',v_day-5,'instapay',v_actor,v_key,
    733.33,4516.67,true,'changed-ref','different payload');
 EXCEPTION WHEN SQLSTATE '23505' THEN v_blocked:=true;
 END;
 IF NOT v_blocked THEN raise exception 'IDEMPOTENCY_PAYLOAD_DRIFT_ALLOWED'; end if;

 -- A second upgrade of the same membership must carry forward old credit exactly once.
 SELECT (733.33+4516.67)*( ((SELECT end_date FROM public.subscriptions WHERE id=v_new)-v_day+1)::numeric /
    ((SELECT end_date FROM public.subscriptions WHERE id=v_new)-
     (SELECT start_date FROM public.subscriptions WHERE id=v_new)+1)::numeric)
 INTO v_credit;
 v_credit:=round(v_credit,2);
 SELECT price_egp INTO v_newprice FROM public.packages_pricing
 WHERE type='membership' and unit='month' and qty=6 and is_active=true;
 v_nextdue:=round(v_newprice-v_credit,2);
 v_result:=public.apply_membership_upgrade_v1(v_new,'6m',v_day-1,'cash',v_actor,gen_random_uuid(),
   v_credit,v_nextdue,true,null,'second upgrade rollback');
 v_newest:=(v_result->>'subscription_id')::uuid;
 IF (SELECT previously_carried_credit_egp FROM public.membership_upgrades WHERE to_subscription_id=v_newest)<>733.33
   OR (SELECT count(*) FROM public.subscription_payments WHERE subscription_id=v_new)<>1
   OR (SELECT count(*) FROM public.subscription_payments WHERE subscription_id=v_newest)<>1
   THEN raise exception 'CHAINED_UPGRADE_CREDIT_OR_LEDGER_FAILED'; end if;

 -- Re-using a real-world bank reference across another upgrade is blocked by index.
 INSERT INTO public.subscriptions(member_id,subscription_type,plan,status,start_date,end_date,amount,amount_due,payment_method)
 VALUES(v_other,'time','1m','active',v_day-20,v_day+9,2200,0,'cash')
 RETURNING id INTO v_old;
 INSERT INTO public.subscription_payments(subscription_id,member_id,amount,payment_method,created_by)
 VALUES(v_old,v_other,2200,'cash',v_actor);
 v_blocked:=false;
 BEGIN
  PERFORM public.apply_membership_upgrade_v1(v_old,'3m',v_day-5,'instapay',v_actor,gen_random_uuid(),
   733.33,4516.67,true,' FICTIONAL-no-bank-match-003 ','reuse ref should fail');
 EXCEPTION WHEN SQLSTATE '23505' THEN v_blocked:=true;
 END;
 IF NOT v_blocked OR (SELECT status FROM public.subscriptions WHERE id=v_old)<>'active'
   THEN raise exception 'DUPLICATE_BANK_REF_NOT_BLOCKED'; end if;

 -- Backdated receipt on an already reconciled daily date must not silently change closed totals.
 INSERT INTO public.payment_validation_batches(payment_method,validation_mode,business_date,
   expected_amount,counted_amount,difference_amount,validated_at,validated_by,created_by)
 VALUES('instapay','daily',v_day-5,0,0,0,now(),v_actor,v_actor)
 RETURNING id INTO v_batch;
 v_blocked:=false;
 BEGIN
  PERFORM public.apply_membership_upgrade_v1(v_old,'3m',v_day-5,'instapay',v_actor,gen_random_uuid(),
    733.33,4516.67,true,'fictional-no-bank-match-004','must reopen validated period');
 EXCEPTION WHEN SQLSTATE '23514' THEN v_blocked:=true;
 END;
 IF NOT v_blocked OR (SELECT status FROM public.subscriptions WHERE id=v_old)<>'active'
   THEN raise exception 'VALIDATED_HISTORICAL_DAY_GUARD_FAILED'; end if;
 DELETE FROM public.payment_validation_batches WHERE id=v_batch;

 -- Existing pending refund must block the transfer.
 INSERT INTO public.membership_refunds(member_id,subscription_id,amount,refund_method,reason,status)
 VALUES(v_other,v_old,100,'bank_transfer','rollback-only refund guard','pending_review');
 v_blocked:=false;
 BEGIN
  PERFORM public.apply_membership_upgrade_v1(v_old,'3m',v_day-1,'cash',v_actor,gen_random_uuid(),
    733.33,4516.67,true,null,'pending refund');
 EXCEPTION WHEN SQLSTATE '23514' THEN v_blocked:=true;
 END;
 IF NOT v_blocked THEN raise exception 'REFUND_GUARD_FAILED'; end if;
 DELETE FROM public.membership_refunds WHERE subscription_id=v_old;

 -- Active freeze must not be silently recalculated as ordinary days.
 INSERT INTO public.subscription_freezes(subscription_id,freeze_from,freeze_until,days,created_by)
 VALUES(v_old,v_day-1,v_day+2,4,v_actor);
 v_blocked:=false;
 BEGIN
  PERFORM public.apply_membership_upgrade_v1(v_old,'3m',v_day-1,'cash',v_actor,gen_random_uuid(),
    733.33,4516.67,true,null,'active freeze');
 EXCEPTION WHEN SQLSTATE '23514' THEN v_blocked:=true;
 END;
 IF NOT v_blocked THEN raise exception 'FREEZE_GUARD_FAILED'; end if;
 DELETE FROM public.subscription_freezes WHERE subscription_id=v_old;

 -- Member's pending renewal must be resolved before the upgrade.
 INSERT INTO public.membership_renewal_requests(member_id,requested_by,source_subscription_id,
   plan,preferred_payment_method,catalog_price_egp,quoted_price_egp,pricing_snapshot)
 VALUES(v_other,v_other,v_old,'3m','cash',5250,5250,'{}');
 v_blocked:=false;
 BEGIN
  PERFORM public.apply_membership_upgrade_v1(v_old,'3m',v_day-1,'cash',v_actor,gen_random_uuid(),
    733.33,4516.67,true,null,'open renewal');
 EXCEPTION WHEN SQLSTATE '23514' THEN v_blocked:=true;
 END;
 IF NOT v_blocked THEN raise exception 'OPEN_RENEWAL_GUARD_FAILED'; end if;
 DELETE FROM public.membership_renewal_requests WHERE member_id=v_other AND source_subscription_id=v_old;

 -- Validation of historical payment date cannot accept future dates.
 v_blocked:=false;
 BEGIN
  PERFORM public.apply_membership_upgrade_v1(v_old,'3m',v_day+1,'cash',v_actor,gen_random_uuid(),
    733.33,4516.67,true,null,'future payment');
 EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked:=true;
 END;
 IF NOT v_blocked THEN raise exception 'FUTURE_PAYMENT_DATE_ACCEPTED'; end if;

 -- Approval attestation is mandatory.
 v_blocked:=false;
 BEGIN
  PERFORM public.apply_membership_upgrade_v1(v_old,'3m',v_day-1,'cash',v_actor,gen_random_uuid(),
    733.33,4516.67,false,null,'no attestation');
 EXCEPTION WHEN SQLSTATE '22023' THEN v_blocked:=true;
 END;
 IF NOT v_blocked THEN raise exception 'UNATTESTED_PAYMENT_ACCEPTED'; end if;

 -- Old outstanding dues block any upgrade until reconciled.
 UPDATE public.subscriptions SET amount_due=100 WHERE id=v_old;
 v_blocked:=false;
 BEGIN
  PERFORM public.apply_membership_upgrade_v1(v_old,'3m',v_day-1,'cash',v_actor,gen_random_uuid(),
    733.33,4516.67,true,null,'test');
 EXCEPTION WHEN SQLSTATE '23514' THEN v_blocked:=true;
 END;
 IF NOT v_blocked THEN raise exception 'OUTSTANDING_DUES_GUARD_FAILED'; end if;
 UPDATE public.subscriptions SET amount_due=0 WHERE id=v_old;

 -- Overlapping active subscription cannot be created via an upgrade.
 INSERT INTO public.subscriptions(member_id,subscription_type,plan,status,start_date,end_date,amount,amount_due,payment_method)
 VALUES(v_other,'time','1m','active',v_day,v_day+30,0,0,'cash');
 v_blocked:=false;
 BEGIN
  PERFORM public.apply_membership_upgrade_v1(v_old,'3m',v_day-1,'cash',v_actor,gen_random_uuid(),
    733.33,4516.67,true,null,'test');
 EXCEPTION WHEN SQLSTATE '23514' THEN v_blocked:=true;
 END;
 IF NOT v_blocked THEN raise exception 'OVERLAPPING_MEMBERSHIP_GUARD_FAILED'; end if;

 -- Historical date already validated requires manual finance reconciliation first.
 -- This is tested on the third member on a fresh single-subscription fixture.
 -- Test trigger installation and table immutability without modifying any member state.
 v_blocked:=false;
 BEGIN
   UPDATE public.membership_upgrades SET approval_note='tampered' WHERE to_subscription_id=v_new;
 EXCEPTION WHEN SQLSTATE '23514' THEN v_blocked:=true;
 END;
 IF NOT v_blocked THEN raise exception 'IMMUTABLE_HISTORY_GUARD_FAILED'; end if;

 RAISE NOTICE 'PASS: permissions, approval, prorata, backdated paid_at, original ledger, idempotency, credit chaining, bank reference, validated backdate, refund/freeze/renewal, attestation, future dates, dues, overlapping coverage, immutable audit';
END
$tests$;
ROLLBACK;
SELECT 'ATOM_MEMBERSHIP_UPGRADES_FULL_SQL_ROLLBACK_PASS' AS result;
