-- Isolated-only finance protection tests. Roll back all fictional fixtures.
\set ON_ERROR_STOP on
BEGIN;
DO $test$
DECLARE
  v_actor uuid := 'cb1298c9-4872-40a3-ae9c-ae9c22987650';
  v_member uuid := 'cb1298c9-4872-40a3-ae9c-ae9c22987651';
  v_split_sub uuid := gen_random_uuid();
  v_split_first uuid := gen_random_uuid();
  v_split_second uuid := gen_random_uuid();
  v_refund_sub uuid := gen_random_uuid();
  v_refund_payment uuid := gen_random_uuid();
  v_matched_sub uuid := gen_random_uuid();
  v_matched_payment uuid := gen_random_uuid();
  v_matched_batch uuid := gen_random_uuid();
  v_bank_import uuid := gen_random_uuid();
  v_bank_line uuid := gen_random_uuid();
  v_blocked boolean;
BEGIN
  INSERT INTO auth.users
    (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
  VALUES
    ('00000000-0000-0000-0000-000000000000',v_actor,'authenticated','authenticated',
     'integrity_guard_admin@example.invalid','not-a-login',now(),now(),now()),
    ('00000000-0000-0000-0000-000000000000',v_member,'authenticated','authenticated',
     'integrity_guard_member@example.invalid','not-a-login',now(),now(),now());

  INSERT INTO public.profiles (user_id,email,role)
  VALUES
    (v_actor,'integrity_guard_admin@example.invalid','super_admin'),
    (v_member,'integrity_guard_member@example.invalid','member')
  ON CONFLICT (user_id) DO UPDATE SET role=excluded.role;

  -- Mixed installments: an edit must change only the targeted payment.
  INSERT INTO public.subscriptions
    (id,member_id,subscription_type,plan,status,start_date,end_date,
     amount,amount_due,payment_method,paid_at)
  VALUES
    (v_split_sub,v_member,'time','1m','active','2026-10-20','2026-11-20',
     2200,0,'card','2026-10-20T12:00:00Z'),
    (v_refund_sub,v_member,'time','1m','active','2026-09-20','2026-10-20',
     2200,0,'card','2026-09-20T12:00:00Z'),
    (v_matched_sub,v_member,'time','1m','active','2026-10-28','2026-11-28',
     2200,0,'card','2026-10-28T12:00:00Z');

  INSERT INTO public.subscription_payments
    (id,subscription_id,member_id,amount,payment_method,paid_at,note)
  VALUES
    (v_split_first,v_split_sub,v_member,1000,'card','2026-10-20T12:00:00Z','First installment'),
    (v_split_second,v_split_sub,v_member,1200,'instapay','2026-10-21T12:00:00Z','Second installment'),
    (v_refund_payment,v_refund_sub,v_member,2200,'card','2026-09-20T12:00:00Z','Refund-bound payment'),
    (v_matched_payment,v_matched_sub,v_member,2200,'card','2026-10-28T12:00:00Z','Bank matched payment');

  PERFORM public.correct_subscription_payment_method_v1(
    v_split_first,'card','bank_transfer','Correct only installment one',v_actor);

  IF (SELECT payment_method FROM public.subscription_payments WHERE id=v_split_first) <> 'bank_transfer'
    OR (SELECT payment_method FROM public.subscription_payments WHERE id=v_split_second) <> 'instapay'
    OR (SELECT amount FROM public.subscription_payments WHERE id=v_split_first) <> 1000
    OR (SELECT amount FROM public.subscription_payments WHERE id=v_split_second) <> 1200
    OR (SELECT amount FROM public.subscriptions WHERE id=v_split_sub) <> 2200
    OR (SELECT amount_due FROM public.subscriptions WHERE id=v_split_sub) <> 0
    OR (SELECT payment_method FROM public.subscriptions WHERE id=v_split_sub) <> 'card'
  THEN RAISE EXCEPTION 'SPLIT_PAYMENT_CORRECTION_AFFECTED_OTHER_INSTALLMENTS'; END IF;

  IF (SELECT count(*) FROM public.subscription_payments WHERE subscription_id=v_split_sub) <> 2
  THEN RAISE EXCEPTION 'SPLIT_PAYMENT_DUPLICATED_LEDGER'; END IF;

  RAISE NOTICE 'MULTIPLE_INSTALLMENTS_ISOLATED_PASS';

  INSERT INTO public.membership_refunds
    (member_id,subscription_id,amount,refund_method,reason,status,refunded_at)
  VALUES
    (v_member,v_refund_sub,500,'bank_transfer','Fixture refund', 'paid',now());

  v_blocked := false;
  BEGIN
    PERFORM public.correct_subscription_payment_method_v1(
      v_refund_payment,'card','instapay','Change refund-linked payment',v_actor);
  EXCEPTION WHEN OTHERS THEN v_blocked := true;
  END;
  IF NOT v_blocked OR
     (SELECT payment_method FROM public.subscription_payments WHERE id=v_refund_payment) <> 'card'
  THEN RAISE EXCEPTION 'REFUND_GUARD_FAILED'; END IF;
  RAISE NOTICE 'REFUND_GUARD_ISOLATED_PASS';

  INSERT INTO public.payment_validation_batches
    (id,payment_method,validation_mode,business_date,period_from,period_to,
     expected_amount,counted_amount,difference_amount,validated_by,created_by)
  VALUES (v_matched_batch,'card','daily','2026-10-28',
          '2026-10-28T11:59:00Z','2026-10-28T12:01:00Z',
          2200,2200,0,v_actor,v_actor);

  INSERT INTO public.payment_validation_batch_items
    (batch_id,source_kind,source_id,amount_snapshot,business_date_snapshot,event_at_snapshot,created_by)
  VALUES(v_matched_batch,'subscription_payment',v_matched_payment,2200,
         '2026-10-28','2026-10-28T12:00:00Z',v_actor);

  INSERT INTO public.reconciliation_bank_imports
    (id,bank_name,statement_from,statement_to,original_filename,storage_path,file_size_bytes,
     file_sha256,row_count,imported_by)
  VALUES(v_bank_import,'CIB','2026-10-28','2026-10-28','local-fixture.csv',
         'local-fixtures/matched.csv',100,repeat('a',64),1,v_actor);

  INSERT INTO public.reconciliation_bank_statement_lines
    (id,import_id,row_number,transaction_date,credit_amount,debit_amount,description)
  VALUES(v_bank_line,v_bank_import,1,'2026-10-28',2200,0,'Local fictional credit');

  INSERT INTO public.reconciliation_bank_matches
    (batch_id,statement_line_id,matched_amount,matched_by)
  VALUES(v_matched_batch,v_bank_line,2200,v_actor);

  v_blocked := false;
  BEGIN
    PERFORM public.correct_subscription_payment_method_v1(
      v_matched_payment,'card','instapay','Matched batch needs release first',v_actor);
  EXCEPTION WHEN OTHERS THEN v_blocked := true;
  END;
  IF NOT v_blocked
    OR (SELECT payment_method FROM public.subscription_payments WHERE id=v_matched_payment) <> 'card'
    OR (SELECT deleted_at FROM public.payment_validation_batches WHERE id=v_matched_batch) IS NOT NULL
    OR (SELECT count(*) FROM public.reconciliation_bank_matches
        WHERE batch_id=v_matched_batch AND released_at IS NULL) <> 1
  THEN RAISE EXCEPTION 'MATCHED_BATCH_GUARD_FAILED'; END IF;
  RAISE NOTICE 'BANK_MATCH_GUARD_ISOLATED_PASS';

  IF (SELECT count(*) FROM public.subscription_payment_method_corrections WHERE payment_id IN
      (v_refund_payment,v_matched_payment)) <> 0
  THEN RAISE EXCEPTION 'BLOCKED_CORRECTION_LEFT_AUDIT_TRAIL'; END IF;
END;
$test$;
ROLLBACK;
SELECT 'PAYMENT_METHOD_FINANCE_GUARDS_ROLLBACK_PASS' AS result;
