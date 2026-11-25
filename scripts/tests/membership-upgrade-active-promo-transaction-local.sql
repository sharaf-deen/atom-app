-- ATOM active promotion upgrade: full atomic ledger regression.
-- CI isolated DB only. Synthetic members, subscriptions, promotions, receipts ROLLBACK.
\set ON_ERROR_STOP on
BEGIN;
DO $tests$
DECLARE
  v_actor uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_promo uuid;
  v_old uuid;
  v_new uuid;
  v_payment uuid;
  v_key uuid := gen_random_uuid();
  v_result jsonb;
  v_replay jsonb;
  v_rejected boolean := false;
BEGIN
  INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
  VALUES
    ('00000000-0000-0000-0000-000000000000',v_actor,'authenticated','authenticated','promo_admin_'||v_actor||'@example.invalid','not-a-login',now(),now(),now()),
    ('00000000-0000-0000-0000-000000000000',v_member,'authenticated','authenticated','promo_member_'||v_member||'@example.invalid','not-a-login',now(),now(),now());
  INSERT INTO public.profiles(user_id,email,role)
  VALUES
    (v_actor,'promo_admin_'||v_actor||'@example.invalid','super_admin'),
    (v_member,'promo_member_'||v_member||'@example.invalid','member')
  ON CONFLICT (user_id) DO UPDATE SET role=excluded.role;

  IF NOT EXISTS(SELECT 1 FROM public.packages_pricing
    WHERE type='membership' AND unit='month' AND qty=6 AND is_active) THEN
    INSERT INTO public.packages_pricing(name,type,unit,qty,price_egp,is_active)
    VALUES('Six months test membership','membership','month',6,8100,true);
  END IF;

  INSERT INTO public.promotions(title,description,discount_type,discount_value,applies_to,min_months,start_date,end_date)
  VALUES('15 pct TEST - isolated rollback','No real offer','percent',15,array['membership']::text[],3,v_today-1,v_today+1)
  RETURNING id INTO v_promo;

  INSERT INTO public.subscriptions(member_id,subscription_type,plan,status,start_date,end_date,amount,amount_due,payment_method)
  VALUES(v_member,'time','3m','active',v_today-18,v_today+74,5250,0,'cash')
  RETURNING id INTO v_old;
  INSERT INTO public.subscription_payments(subscription_id,member_id,amount,payment_method,paid_at,created_by)
  VALUES(v_old,v_member,5250,'cash',now()-interval '18 days',v_actor);

  -- The original undiscounted expected supplement must never be accepted.
  BEGIN
    PERFORM public.apply_membership_upgrade_v1(
      v_old,'6m',v_today-3,'cash',v_actor,gen_random_uuid(),4233.87,3866.13,true,null,'STALE PROMO TEST');
  EXCEPTION WHEN SQLSTATE '23514' THEN v_rejected := true;
  END;
  IF NOT v_rejected OR (SELECT status FROM public.subscriptions WHERE id=v_old)<>'active' THEN
    RAISE EXCEPTION 'STALE_UNDISCOUNTED_QUOTE_ACCEPTED';
  END IF;

  v_result:=public.apply_membership_upgrade_v1(
    v_old,'6m',v_today-3,'cash',v_actor,v_key,4233.87,2651.13,true,null,'PROMOTION TEST');
  IF coalesce((v_result->>'ok')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'DISCOUNTED_UPGRADE_FAILED %',v_result;
  END IF;
  v_new:=(v_result->>'subscription_id')::uuid;
  v_payment:=(v_result->>'payment_id')::uuid;

  IF (SELECT count(*) FROM public.membership_upgrades
      WHERE from_subscription_id=v_old AND to_subscription_id=v_new
        AND original_paid_egp=5250 AND remaining_days=75 AND original_days=93
        AND transferred_credit_egp=4233.87 AND target_list_price_egp=8100
        AND promotion_id=v_promo AND promotion_discount_egp=1215
        AND target_price_egp=6885 AND additional_payment_egp=2651.13)<>1 THEN
    RAISE EXCEPTION 'PROMOTION_UPGRADE_AUDIT_MISMATCH';
  END IF;
  IF (SELECT amount FROM public.subscription_payments WHERE id=v_payment)<>2651.13
    OR (SELECT amount FROM public.subscriptions WHERE id=v_new)<>2651.13
    OR (SELECT status FROM public.subscriptions WHERE id=v_old)<>'cancelled'
    OR (SELECT count(*) FROM public.subscription_payments WHERE subscription_id=v_old)<>1 THEN
    RAISE EXCEPTION 'PROMOTION_LEDGER_OR_CONTRACT_MISMATCH';
  END IF;

  v_replay:=public.apply_membership_upgrade_v1(
    v_old,'6m',v_today-3,'cash',v_actor,v_key,4233.87,2651.13,true,null,'PROMOTION TEST');
  IF (v_replay->>'already_applied')::boolean IS NOT TRUE
    OR (SELECT count(*) FROM public.membership_upgrades WHERE from_subscription_id=v_old)<>1
    OR (SELECT count(*) FROM public.subscription_payments WHERE subscription_id=v_new)<>1 THEN
    RAISE EXCEPTION 'PROMOTION_IDEMPOTENCY_FAILED';
  END IF;

  IF (SELECT count(*) FROM public.admin_income_events_v1
      WHERE source_kind='subscription_payment' AND subscription_id=v_new)<>1
    OR (SELECT amount FROM public.admin_income_events_v1 WHERE source_kind='subscription_payment' AND source_id=v_payment)<>2651.13 THEN
    RAISE EXCEPTION 'PROMOTION_REVENUE_MISMATCH';
  END IF;

  RAISE NOTICE 'PASS: active offer atomically applied, stale quote blocked, audit/receipt/idempotency/revenue verified.';
END $tests$;
ROLLBACK;
