-- Security Hardening 1C.4: SQL-level settlement/update/deletion invariants.
-- STAGING ONLY. Not an API E2E test. Never deploy as a migration.
-- Each operation on synthetic fixtures runs in a nested exception block which
-- ALWAYS rolls back, including notifications and payment history. No real data touched.
DO $outer$
DECLARE outcome text := 'NOT_RUN';
BEGIN
  BEGIN
    DECLARE
      member_uuid uuid := gen_random_uuid();
      actor_uuid uuid;
      sub_paid uuid;
      sub_empty uuid;
      changed_count integer;
      payment_total numeric;
      due_left numeric;
      paid_so_far numeric;
      actual_end date;
    BEGIN
      SELECT user_id INTO actor_uuid FROM public.profiles WHERE role='super_admin' ORDER BY created_at LIMIT 1;
      IF actor_uuid IS NULL THEN RAISE EXCEPTION 'TEST_FAIL: missing Staging super admin'; END IF;
      INSERT INTO public.profiles(user_id,email,member_id,role)
      VALUES (member_uuid,'security1c4-'||left(replace(member_uuid::text,'-',''),16)||'@invalid.example',
        'QA-'||left(replace(member_uuid::text,'-',''),16),'member');

      INSERT INTO public.subscriptions
        (member_id,plan,subscription_type,status,amount,amount_due,payment_method,start_date,end_date)
      VALUES (member_uuid,'3m','time','active',0,100,'cash',CURRENT_DATE,CURRENT_DATE+89)
      RETURNING id INTO sub_paid;

      UPDATE public.subscriptions SET amount=40,amount_due=60,payment_method='instapay'
        WHERE id=sub_paid AND amount_due=100;
      GET DIAGNOSTICS changed_count = ROW_COUNT;
      IF changed_count<>1 THEN RAISE EXCEPTION 'TEST_FAIL: settlement CAS update'; END IF;
      INSERT INTO public.subscription_payments
        (subscription_id,member_id,amount,payment_method,note,created_by)
      VALUES (sub_paid,member_uuid,40,'instapay','Isolated 1C4 test payment',actor_uuid);
      SELECT amount,amount_due INTO paid_so_far,due_left FROM public.subscriptions WHERE id=sub_paid;
      SELECT coalesce(sum(amount),0) INTO payment_total FROM public.subscription_payments WHERE subscription_id=sub_paid;
      IF paid_so_far<>40 OR due_left<>60 OR payment_total<>40 THEN
        RAISE EXCEPTION 'TEST_FAIL: settlement integrity paid %, due %, history %',paid_so_far,due_left,payment_total;
      END IF;

      UPDATE public.subscriptions SET end_date=CURRENT_DATE+90 WHERE id=sub_paid;
      SELECT end_date INTO actual_end FROM public.subscriptions WHERE id=sub_paid;
      IF actual_end<>CURRENT_DATE+90 THEN RAISE EXCEPTION 'TEST_FAIL: update did not persist'; END IF;
      BEGIN
        DELETE FROM public.subscriptions WHERE id=sub_paid;
        RAISE EXCEPTION 'TEST_FAIL: paid history was deletable';
      EXCEPTION WHEN check_violation THEN NULL;
      END;
      IF NOT EXISTS (SELECT 1 FROM public.subscriptions WHERE id=sub_paid) THEN
        RAISE EXCEPTION 'TEST_FAIL: history-protected subscription disappeared';
      END IF;

      INSERT INTO public.subscriptions
        (member_id,plan,subscription_type,status,amount,amount_due,payment_method,start_date,end_date)
      VALUES (member_uuid,'1m','time','active',0,0,'cash',CURRENT_DATE,CURRENT_DATE+30)
      RETURNING id INTO sub_empty;
      DELETE FROM public.subscriptions WHERE id=sub_empty;
      IF EXISTS (SELECT 1 FROM public.subscriptions WHERE id=sub_empty) THEN
        RAISE EXCEPTION 'TEST_FAIL: zero-history delete did not work';
      END IF;

      outcome := 'PASS: settlement ledger, subscription update, history-protected delete, zero-history delete; rollback';
      RAISE EXCEPTION 'ROLLBACK_FINANCIAL_TEST' USING ERRCODE='PZ001';
    END;
  EXCEPTION WHEN SQLSTATE 'PZ001' THEN
    IF SQLERRM<>'ROLLBACK_FINANCIAL_TEST' THEN RAISE; END IF;
    RAISE NOTICE '%', outcome;
  END;
END
$outer$;
