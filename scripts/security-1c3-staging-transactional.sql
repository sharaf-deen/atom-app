-- Security Hardening 1C.3 — isolated financial RPC WRITE-PATH regression.
-- Staging only. DO NOT execute in Production. This test creates fictitious data
-- within a PL/pgSQL subtransaction and ALWAYS ROLLS BACK the entire fixture.
-- No real subscriptions, payments, or refunds are updated.
-- Includes the inclusive-end-date freeze convention: p_from..p_to = 8 days.
DO $outer$
DECLARE
  test_result text := 'NOT_RUN';
BEGIN
  BEGIN
    DECLARE
      actor_id uuid;
      member_uuid uuid := gen_random_uuid();
      sub_id uuid;
      refund_uuid uuid;
      created_freeze_id uuid;
      original_end date := current_date + 89;
      result jsonb;
      current_end date;
      count_freezes integer;
    BEGIN
      SELECT user_id INTO actor_id
      FROM public.profiles WHERE role='super_admin'
      ORDER BY created_at LIMIT 1;
      IF actor_id IS NULL THEN RAISE EXCEPTION 'TEST_FAIL: no staging superadmin'; END IF;

      INSERT INTO public.profiles (user_id,email,role,member_id)
      VALUES (member_uuid,
        'security1c3-'||left(replace(member_uuid::text,'-',''),16)||'@invalid.example',
        'member', 'QA-'||left(replace(member_uuid::text,'-',''),16));

      INSERT INTO public.subscriptions
        (member_id,plan,subscription_type,status,amount,amount_due,paid_at,payment_method,start_date,end_date)
      VALUES (member_uuid,'3m','time','active',0,0,now(),'cash',current_date,original_end)
      RETURNING id INTO sub_id;

      result := public.manage_subscription_freeze_atomic(
        sub_id,'create',NULL,current_date+1,current_date+8,actor_id);
      SELECT count(*) INTO count_freezes FROM public.subscription_freezes
        WHERE subscription_id=sub_id AND cleared_at IS NULL;
      SELECT end_date INTO current_end FROM public.subscriptions WHERE id=sub_id;
      IF count_freezes <> 1 OR current_end <> original_end + 8 THEN
        RAISE EXCEPTION 'TEST_FAIL: freeze create count %, end %, baseline %',
          count_freezes,current_end,original_end;
      END IF;

      SELECT id INTO created_freeze_id FROM public.subscription_freezes
        WHERE subscription_id=sub_id AND cleared_at IS NULL LIMIT 1;
      result := public.manage_subscription_freeze_atomic(
        sub_id,'delete',created_freeze_id,NULL,NULL,actor_id);
      SELECT count(*) INTO count_freezes FROM public.subscription_freezes
        WHERE subscription_id=sub_id AND cleared_at IS NULL;
      SELECT end_date INTO current_end FROM public.subscriptions WHERE id=sub_id;
      IF count_freezes <> 0 OR current_end <> original_end THEN
        RAISE EXCEPTION 'TEST_FAIL: freeze delete count %, end %',count_freezes,current_end;
      END IF;

      INSERT INTO public.membership_refunds
        (member_id,subscription_id,amount,refund_method,reason,status)
      VALUES (member_uuid,sub_id,1,'cash','Isolated security test','paid')
      RETURNING id INTO refund_uuid;

      result := public.apply_membership_refund_impact_atomic(
        refund_uuid,'keep_active','Isolated security test',NULL,actor_id);
      IF coalesce(result->>'ok','false') <> 'true' THEN
        RAISE EXCEPTION 'TEST_FAIL: refund RPC result %',result;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.membership_refunds
        WHERE id=refund_uuid AND subscription_impact_status='applied'
          AND subscription_impact_action='keep_active'
      ) THEN RAISE EXCEPTION 'TEST_FAIL: refund impact not applied'; END IF;
      SELECT end_date INTO current_end FROM public.subscriptions WHERE id=sub_id;
      IF current_end <> original_end THEN
        RAISE EXCEPTION 'TEST_FAIL: keep_active changed end date';
      END IF;

      test_result := 'PASS: freeze create/delete and refund keep_active; fixtures rolled back';
      RAISE EXCEPTION 'ROLLBACK_FINANCIAL_TEST' USING ERRCODE='PZ001';
    END;
  EXCEPTION WHEN SQLSTATE 'PZ001' THEN
    IF SQLERRM <> 'ROLLBACK_FINANCIAL_TEST' THEN RAISE; END IF;
    RAISE NOTICE '%',test_result;
  END;
END
$outer$;
