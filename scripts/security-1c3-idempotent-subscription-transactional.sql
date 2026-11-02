-- Security Hardening 1C.3 — successful create/renew RPC + payment ledger regression.
-- Run only on isolated local DB or Staging. NEVER in Production.
-- Uses fictitious member/acceptances/subscriptions inside a PL/pgSQL
-- subtransaction that is ALWAYS rolled back by the sentinel exception.
DO $outer$
DECLARE
  test_result text := 'NOT_RUN';
BEGIN
  BEGIN
    DECLARE
      actor_id uuid;
      member_uuid uuid := gen_random_uuid();
      create_request uuid := gen_random_uuid();
      renew_request uuid := gen_random_uuid();
      create_hash text := repeat('a',64);
      renew_hash text := repeat('b',64);
      create_payload jsonb;
      renew_payload jsonb;
      created jsonb;
      replayed jsonb;
      renewed jsonb;
      created_id uuid;
      renewed_id uuid;
      payment_total numeric;
      payment_rows integer;
      active_required integer;
      accepted integer;
    BEGIN
      SELECT user_id INTO actor_id FROM public.profiles
      WHERE role='super_admin' ORDER BY created_at LIMIT 1;
      IF actor_id IS NULL THEN RAISE EXCEPTION 'TEST_FAIL: Staging superadmin missing'; END IF;

      INSERT INTO public.profiles(user_id,email,role,member_id,date_of_birth)
      VALUES (member_uuid,
        'security1c3-'||left(replace(member_uuid::text,'-',''),16)||'@invalid.example',
        'member','QA-'||left(replace(member_uuid::text,'-',''),16),'2000-01-01');

      INSERT INTO public.member_legal_acceptances(
        member_user_id,document_version_id,document_key_snapshot,
        document_title_snapshot,document_version_snapshot,document_url_snapshot,
        acceptor_name,acceptor_capacity,member_date_of_birth_snapshot,
        is_minor_snapshot,recorded_by_user_id,source)
      SELECT member_uuid,d.id,d.document_key,d.title,d.version_label,d.published_url,
        'Test Participant','participant','2000-01-01'::date,false,actor_id,'manual_backfill'
      FROM public.legal_document_versions d
      WHERE d.status='active' AND d.is_required=true;

      SELECT count(*) INTO active_required FROM public.legal_document_versions
        WHERE status='active' AND is_required=true;
      SELECT count(*) INTO accepted FROM public.member_legal_acceptances WHERE member_user_id=member_uuid;
      IF active_required=0 OR accepted<>active_required THEN
        RAISE EXCEPTION 'TEST_FAIL: legal acceptances % / %',accepted,active_required;
      END IF;

      create_payload := jsonb_build_object(
        'member_id',member_uuid,'plan','1m','subscription_type','time',
        'status','active','amount',100,'amount_due',0,'payment_method','cash',
        'paid_at',now(),'start_date',current_date,'end_date',current_date+30);
      created := public.atom_create_subscription_idempotent(
        create_payload,actor_id,create_request,create_hash,'create');
      created_id := (created->>'subscription_id')::uuid;
      IF created_id IS NULL OR coalesce((created->>'replayed')::boolean,true) THEN
        RAISE EXCEPTION 'TEST_FAIL: invalid create response %',created;
      END IF;

      replayed := public.atom_create_subscription_idempotent(
        create_payload,actor_id,create_request,create_hash,'create');
      IF (replayed->>'subscription_id')::uuid IS DISTINCT FROM created_id
        OR coalesce((replayed->>'replayed')::boolean,false) IS NOT TRUE THEN
        RAISE EXCEPTION 'TEST_FAIL: idempotency replay %',replayed;
      END IF;

      renew_payload := jsonb_build_object(
        'member_id',member_uuid,'plan','1m','subscription_type','time',
        'status','active','amount',50,'amount_due',0,'payment_method','instapay',
        'paid_at',now(),'start_date',current_date+31,'end_date',current_date+61);
      renewed := public.atom_create_subscription_idempotent(
        renew_payload,actor_id,renew_request,renew_hash,'renew');
      renewed_id := (renewed->>'subscription_id')::uuid;
      IF renewed_id IS NULL OR renewed_id=created_id THEN
        RAISE EXCEPTION 'TEST_FAIL: renewal missing %',renewed;
      END IF;

      SELECT count(*),coalesce(sum(amount),0) INTO payment_rows,payment_total
      FROM public.subscription_payments WHERE member_id=member_uuid;
      IF payment_rows<>2 OR payment_total<>150 THEN
        RAISE EXCEPTION 'TEST_FAIL: payment ledger count %, total %',
          payment_rows,payment_total;
      END IF;
      IF (SELECT count(*) FROM public.subscriptions WHERE member_id=member_uuid)<>2 THEN
        RAISE EXCEPTION 'TEST_FAIL: expected 2 subscriptions';
      END IF;
      IF (SELECT count(*) FROM public.atom_subscription_idempotency
          WHERE member_id=member_uuid)<>2 THEN
        RAISE EXCEPTION 'TEST_FAIL: idempotency log unexpected count';
      END IF;

      test_result:='PASS: create, idempotent replay, renew, two ledger payments; all fixtures rolled back';
      RAISE EXCEPTION 'ROLLBACK_FINANCIAL_TEST' USING ERRCODE='PZ001';
    END;
  EXCEPTION WHEN SQLSTATE 'PZ001' THEN
    IF SQLERRM<>'ROLLBACK_FINANCIAL_TEST' THEN RAISE; END IF;
    RAISE NOTICE '%',test_result;
  END;
END
$outer$;
