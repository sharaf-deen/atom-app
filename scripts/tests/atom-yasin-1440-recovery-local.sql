-- #1440 isolated, rollback-only financial recovery regression
\set ON_ERROR_STOP on
BEGIN;
DO $fixture$
DECLARE
 v_actor uuid:='e150ed15-f582-4a4f-81a5-010bf49a9b16';
 v_member uuid:='18bed597-5f7e-4518-915f-0c5c5f8d0f05';
 v_pre jsonb;v_applied jsonb;
BEGIN
 INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
 VALUES
 ('00000000-0000-0000-0000-000000000000',v_actor,'authenticated','authenticated','recovery1440admin@example.invalid','unused',now(),now(),now()),
 ('00000000-0000-0000-0000-000000000000',v_member,'authenticated','authenticated','recovery1440member@example.invalid','unused',now(),now(),now());
 UPDATE public.profiles SET role='super_admin' WHERE user_id=v_actor;
 UPDATE public.profiles SET first_name='Yasin',last_name='Mohamed',member_id='ATOM-000150' WHERE user_id=v_member;
 INSERT INTO public.promotions(title,discount_type,discount_value,applies_to,min_months,start_date,end_date)
 VALUES('November Membership Offer','percent',15,array['membership']::text[],3,'2026-11-25','2026-11-30');
 INSERT INTO public.subscriptions(id,member_id,subscription_type,plan,status,start_date,end_date,amount,amount_due,payment_method,paid_at)
 VALUES
 ('cb461683-0263-4f58-8079-8c41897ffd2a',v_member,'time','1m','active','2026-11-02','2026-12-02',2200,0,'cash','2026-11-02 12:00:00+00'),
 ('c3b74b46-11ff-4d67-a150-b0053598d2af',v_member,'time','3m','active','2026-12-03','2027-03-03',3000,0,'cash','2026-11-24 12:00:00+00');
 INSERT INTO public.subscription_payments(id,subscription_id,member_id,amount,payment_method,paid_at,created_by)
 VALUES
 ('d7d3fca9-5f4f-491f-951f-fdecf318195d','cb461683-0263-4f58-8079-8c41897ffd2a',v_member,2200,'cash','2026-11-02 12:00:00+00',v_actor),
 ('c670b8df-a1da-4f28-99f5-ea837aa03724','c3b74b46-11ff-4d67-a150-b0053598d2af',v_member,2600,'cash','2026-11-23 12:00:00+00',v_actor),
 ('83bcb8c2-fb96-4c95-8e95-9a65e79f7116','c3b74b46-11ff-4d67-a150-b0053598d2af',v_member,400,'cash','2026-11-24 12:00:00+00',v_actor);
 -- Three legitimate kiosk attendances on the original one-month subscription.
 INSERT INTO public.attendance(member_id,subscription_id,date,source,valid)
 VALUES
 (v_member,'cb461683-0263-4f58-8079-8c41897ffd2a','2026-11-14','kiosk',true),
 (v_member,'cb461683-0263-4f58-8079-8c41897ffd2a','2026-11-16','kiosk',true),
 (v_member,'cb461683-0263-4f58-8079-8c41897ffd2a','2026-11-23','kiosk',true);
 INSERT INTO public.invoices(id,member_id,subscription_id,invoice_number,amount,paid_at,pdf_path)
 VALUES
 ('8471e07e-a590-42f0-a0f6-8f51a9a7a38b',v_member,'c3b74b46-11ff-4d67-a150-b0053598d2af','INV-20261124-053598D2AF',3000,'2026-11-24 12:00:00+00','test/recovery-full.pdf'),
 ('f3a2aec4-dc6a-4c0b-89f6-9c0ec0278a53',v_member,'c3b74b46-11ff-4d67-a150-b0053598d2af','INV-20261123-053598D2AF',2600,'2026-11-23 12:00:00+00','test/recovery-deposit.pdf');
 INSERT INTO public.payment_validation_batches(id,payment_method,validation_mode,business_date,period_from,period_to,expected_amount,counted_amount)
 VALUES('6684f5d1-4fc5-4586-b998-9c46b5044504','cash','daily','2026-11-23','2026-11-23 00:00:00+02','2026-11-24 00:00:00+02',2600,2600);
 INSERT INTO public.payment_validation_batch_items(batch_id,source_kind,source_id,amount_snapshot,business_date_snapshot,event_at_snapshot)
 VALUES('6684f5d1-4fc5-4586-b998-9c46b5044504','subscription_payment','c670b8df-a1da-4f28-99f5-ea837aa03724',2600,'2026-11-23','2026-11-23 12:00:00+00');

 IF (select sum(amount) from public.admin_income_events_v1
     where source_kind='subscription_payment' and member_id=v_member)<>5200
 THEN RAISE EXCEPTION 'PRECONDITION_CASH_MISMATCH';END IF;
 v_pre:=public.atom_correct_yasin_1440(v_actor,false);
 IF v_pre->>'mode'<>'preview' or (v_pre->>'outstandingEGP')::numeric<>1294.76
 THEN RAISE EXCEPTION 'PREVIEW_MISMATCH: %',v_pre;END IF;

 v_applied:=public.atom_correct_yasin_1440(v_actor,true);
 IF (v_applied->>'ok')::boolean IS DISTINCT FROM true
   OR (SELECT count(*) from public.subscriptions where member_id=v_member and status='active')<>1
   OR (SELECT amount_due from public.subscriptions where id='c3b74b46-11ff-4d67-a150-b0053598d2af')<>1294.76
   OR (SELECT start_date from public.subscriptions where id='c3b74b46-11ff-4d67-a150-b0053598d2af')<>'2026-11-25'::date
   OR (SELECT end_date from public.subscriptions where id='c3b74b46-11ff-4d67-a150-b0053598d2af')<>'2027-02-25'::date
   OR (SELECT count(*) from public.atom_payment_voids where payment_id='83bcb8c2-fb96-4c95-8e95-9a65e79f7116')<>1
   OR (SELECT count(*) from public.atom_invoice_corrections where recovery_id=(v_applied->>'recoveryId')::uuid)<>2
   OR (SELECT count(*) from public.attendance where member_id=v_member
        and subscription_id='cb461683-0263-4f58-8079-8c41897ffd2a')<>3
   OR (SELECT count(*) from public.membership_upgrades where member_id=v_member)<>1
   OR (SELECT count(*) from public.subscription_payments where member_id=v_member)<>3
   OR (SELECT sum(amount) from public.admin_income_events_v1 where source_kind='subscription_payment' and member_id=v_member)<>4800
   OR (SELECT count(*) from public.payment_validation_batch_items where source_id='c670b8df-a1da-4f28-99f5-ea837aa03724' and released_at is null)<>1
 THEN RAISE EXCEPTION 'RECOVERY_POSTCHECK_FAILED: %',v_applied;END IF;
 IF (public.atom_correct_yasin_1440(v_actor,true)->>'alreadyApplied')::boolean IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'RECOVERY_NOT_IDEMPOTENT';END IF;
 RAISE NOTICE 'PASS: recovery, invoice flags, 400 void, 2600 original cash + batch, 1294.76 due, one active member contract, idempotency.';
END $fixture$;
ROLLBACK;
