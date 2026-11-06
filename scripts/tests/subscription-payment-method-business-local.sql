-- Isolated PostgreSQL integration test. Run ONLY in local CI after installing
-- scripts/sql/subscription-payment-method-correction-DRAFT.sql.
-- All fixture data and corrections roll back at the end.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  actor_id uuid := '965d5c39-6e78-4dcc-afc3-f5eeb6d4b77b';
  member_id uuid := '965d5c39-6e78-4dcc-afc3-f5eeb6d4b77c';
  subscription_id uuid := gen_random_uuid();
  first_payment_id uuid := gen_random_uuid();
  batch_id uuid := gen_random_uuid();
  returned_batch uuid;
  returned_method text;
  count_payments integer;
  value_total numeric;
  remaining_due numeric;
  batch_deleted_at timestamptz;
  correction_count integer;
  failure_rejected boolean;
BEGIN
  -- Each run starts with a reset local DB and uses fictional identities.
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at)
  VALUES
    ('00000000-0000-0000-0000-000000000000', actor_id,
     'authenticated','authenticated','method_integrity_admin@example.invalid',
     'not-a-login',now(),now(),now()),
    ('00000000-0000-0000-0000-000000000000', member_id,
     'authenticated','authenticated','method_integrity_member@example.invalid',
     'not-a-login',now(),now(),now());

  INSERT INTO public.profiles (user_id, email, role)
  VALUES (actor_id,'method_integrity_admin@example.invalid','super_admin'),
         (member_id,'method_integrity_member@example.invalid','member')
  ON CONFLICT (user_id) DO UPDATE SET role = excluded.role;

  IF NOT public.is_super_admin(actor_id) THEN
    RAISE EXCEPTION 'TEST_SETUP_SUPER_ADMIN_MISSING';
  END IF;

  INSERT INTO public.subscriptions
    (id, member_id, subscription_type, plan, status, start_date, end_date,
     amount, amount_due, payment_method, paid_at)
  VALUES
    (subscription_id, member_id, 'time', '1m', 'active',
     '2026-10-29','2026-11-29',2200,0,'card','2026-10-29T12:00:00Z');

  INSERT INTO public.subscription_payments
    (id, subscription_id, member_id, amount, payment_method, paid_at, note)
  VALUES
    (first_payment_id, subscription_id, member_id,2200,'card',
     '2026-10-29T12:00:00Z','Test initial payment');

  INSERT INTO public.payment_validation_batches
    (id, payment_method, validation_mode, business_date, period_from, period_to,
     expected_amount, counted_amount, difference_amount, validated_by, created_by)
  VALUES
    (batch_id,'card','daily','2026-10-29',
     '2026-10-29T11:59:00Z','2026-10-29T12:01:00Z',
     2200,2200,0,actor_id,actor_id);

  INSERT INTO public.payment_validation_batch_items
    (batch_id, source_kind, source_id, amount_snapshot, business_date_snapshot,
     event_at_snapshot, created_by)
  VALUES
    (batch_id,'subscription_payment',first_payment_id,
     2200,'2026-10-29','2026-10-29T12:00:00Z',actor_id);

  -- Authorization: only actual super admins can invoke this operation.
  failure_rejected := false;
  BEGIN
    PERFORM public.correct_subscription_payment_method_v1(
      first_payment_id,'card','instapay','Unauthorized member attempt',member_id);
  EXCEPTION WHEN OTHERS THEN failure_rejected := true;
  END;
  IF NOT failure_rejected THEN
    RAISE EXCEPTION 'NON_ADMIN_CORRECTION_ALLOWED';
  END IF;

  SELECT previous_batch_id,new_method INTO returned_batch,returned_method
    FROM public.correct_subscription_payment_method_v1(
      first_payment_id,'card','instapay','Confirmed third-party InstaPay payment',actor_id);

  IF returned_batch IS DISTINCT FROM batch_id OR returned_method <> 'instapay' THEN
    RAISE EXCEPTION 'CORRECT_METHOD_RESULT_MISMATCH';
  END IF;

  SELECT count(*),coalesce(sum(amount),0) INTO count_payments,value_total
    FROM public.subscription_payments WHERE subscription_id = subscription_id;
  -- Test exact identity via payment ID (do not assume single payment globally).
  IF (SELECT payment_method FROM public.subscription_payments WHERE id=first_payment_id) <> 'instapay' THEN
    RAISE EXCEPTION 'PAYMENT_METHOD_NOT_CORRECTED';
  END IF;
  IF (SELECT amount FROM public.subscription_payments WHERE id=first_payment_id) <> 2200 THEN
    RAISE EXCEPTION 'CORRECTION_ALTERED_RECEIPT_AMOUNT';
  END IF;
  SELECT amount_due INTO remaining_due FROM public.subscriptions WHERE id=subscription_id;
  IF remaining_due <> 0 THEN RAISE EXCEPTION 'CORRECTION_ALTERED_DUE'; END IF;

  SELECT deleted_at INTO batch_deleted_at FROM public.payment_validation_batches WHERE id=batch_id;
  IF batch_deleted_at IS NULL THEN RAISE EXCEPTION 'OLD_BATCH_STILL_ACTIVE'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.payment_validation_batch_items
    WHERE batch_id=batch_id AND released_at IS NULL
  ) THEN RAISE EXCEPTION 'OLD_BATCH_ITEM_NOT_RELEASED'; END IF;

  SELECT count(*) INTO correction_count FROM public.subscription_payment_method_corrections
    WHERE payment_id = first_payment_id;
  IF correction_count <> 1 THEN RAISE EXCEPTION 'AUDIT_RECORD_MISSING'; END IF;

  -- Retry with the stale old method must fail; there must be no duplicate entries.
  failure_rejected := false;
  BEGIN
    PERFORM public.correct_subscription_payment_method_v1(
      first_payment_id,'card','instapay','Duplicate stale correction',actor_id);
  EXCEPTION WHEN OTHERS THEN failure_rejected := true;
  END;
  IF NOT failure_rejected THEN RAISE EXCEPTION 'STALE_RETRY_ACCEPTED'; END IF;
  IF (SELECT count(*) FROM public.subscription_payment_method_corrections
      WHERE payment_id=first_payment_id) <> 1 THEN
    RAISE EXCEPTION 'DUPLICATE_AUDIT_RECORD';
  END IF;

  RAISE NOTICE 'METHOD_CORRECTION_BUSINESS_TEST_PASS';
END;
$test$;

ROLLBACK;
SELECT 'METHOD_CORRECTION_ISOLATED_ROLLBACK_PASS' AS result;
