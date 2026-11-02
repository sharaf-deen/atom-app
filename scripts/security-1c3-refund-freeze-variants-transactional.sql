-- Security Hardening 1C.3 — refund impact variants and freeze update lifecycle.
-- Staging or isolated local DB ONLY. NEVER Production.
-- A nested exception subtransaction rolls back every fictitious record.
DO $outer$
DECLARE
  test_result text := 'NOT_RUN';
BEGIN
  BEGIN
    DECLARE
      actor_id uuid;
      member_uuid uuid:=gen_random_uuid();
      freeze_subscription uuid;
      cancel_subscription uuid;
      shorten_subscription uuid;
      freeze_id uuid;
      refund_cancel uuid;
      refund_shorten uuid;
      result jsonb;
      original_end date:=current_date+89;
      actual_end date;
      actual_status text;
      n integer;
    BEGIN
      SELECT user_id INTO actor_id FROM public.profiles WHERE role='super_admin'
        ORDER BY created_at LIMIT 1;
      IF actor_id IS NULL THEN RAISE EXCEPTION 'TEST_FAIL: missing Staging superadmin'; END IF;

      INSERT INTO public.profiles(user_id,email,member_id,role)
        VALUES (member_uuid,'security1c3-'||left(replace(member_uuid::text,'-',''),16)||'@invalid.example',
        'QA-'||left(replace(member_uuid::text,'-',''),16),'member');

      INSERT INTO public.subscriptions
        (member_id,plan,subscription_type,status,amount,amount_due,payment_method,start_date,end_date)
        VALUES(member_uuid,'3m','time','active',0,0,'cash',current_date,original_end)
        RETURNING id INTO freeze_subscription;
      result:=public.manage_subscription_freeze_atomic(
        freeze_subscription,'create',NULL,current_date+1,current_date+5,actor_id);
      SELECT id INTO freeze_id FROM public.subscription_freezes
        WHERE subscription_id=freeze_subscription AND cleared_at IS NULL;
      result:=public.manage_subscription_freeze_atomic(
        freeze_subscription,'update',freeze_id,current_date+2,current_date+9,actor_id);
      SELECT end_date INTO actual_end FROM public.subscriptions WHERE id=freeze_subscription;
      SELECT count(*) INTO n FROM public.subscription_freezes
        WHERE id=freeze_id AND days=8 AND cleared_at IS NULL;
      IF n<>1 OR actual_end<>original_end+8 THEN
        RAISE EXCEPTION 'TEST_FAIL: updated freeze %, %',n,actual_end;
      END IF;

      INSERT INTO public.subscriptions
        (member_id,plan,subscription_type,status,amount,amount_due,payment_method,start_date,end_date)
        VALUES(member_uuid,'3m','time','active',0,0,'cash',current_date,original_end)
        RETURNING id INTO cancel_subscription;
      INSERT INTO public.membership_refunds(member_id,subscription_id,amount,refund_method,reason,status)
        VALUES(member_uuid,cancel_subscription,1,'cash','Isolated cancellation test','paid')
        RETURNING id INTO refund_cancel;
      result:=public.apply_membership_refund_impact_atomic(
        refund_cancel,'cancel_subscription','Isolated cancellation test',NULL,actor_id);
      SELECT status,end_date INTO actual_status,actual_end
        FROM public.subscriptions WHERE id=cancel_subscription;
      IF actual_status<>'cancelled' OR actual_end<>current_date THEN
        RAISE EXCEPTION 'TEST_FAIL: cancel impact status %, date %',actual_status,actual_end;
      END IF;

      INSERT INTO public.subscriptions
        (member_id,plan,subscription_type,status,amount,amount_due,payment_method,start_date,end_date)
        VALUES(member_uuid,'3m','time','active',0,0,'cash',current_date,original_end)
        RETURNING id INTO shorten_subscription;
      INSERT INTO public.membership_refunds(member_id,subscription_id,amount,refund_method,reason,status)
        VALUES(member_uuid,shorten_subscription,1,'cash','Isolated shorten test','paid')
        RETURNING id INTO refund_shorten;
      result:=public.apply_membership_refund_impact_atomic(
        refund_shorten,'shorten_subscription','Isolated shorten test',current_date+30,actor_id);
      SELECT status,end_date INTO actual_status,actual_end
        FROM public.subscriptions WHERE id=shorten_subscription;
      IF actual_status<>'active' OR actual_end<>current_date+30 THEN
        RAISE EXCEPTION 'TEST_FAIL: shorten impact status %, date %',actual_status,actual_end;
      END IF;

      BEGIN
        PERFORM public.apply_membership_refund_impact_atomic(
          refund_shorten,'shorten_subscription','Second impact should fail',current_date+20,actor_id);
        RAISE EXCEPTION 'TEST_FAIL: duplicate refund impact allowed';
      EXCEPTION WHEN unique_violation THEN
        NULL;
      END;

      test_result:='PASS: freeze update, refund cancel, refund shorten, double-apply rejection; rolled back';
      RAISE EXCEPTION 'ROLLBACK_FINANCIAL_TEST' USING ERRCODE='PZ001';
    END;
  EXCEPTION WHEN SQLSTATE 'PZ001' THEN
    IF SQLERRM<>'ROLLBACK_FINANCIAL_TEST' THEN RAISE; END IF;
    RAISE NOTICE '%',test_result;
  END;
END
$outer$;
