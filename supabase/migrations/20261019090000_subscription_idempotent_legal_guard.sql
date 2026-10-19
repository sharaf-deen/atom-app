-- Functional 1C.5B.3B: DB-side legal consent guard; preserves existing function grants.
-- A single CREATE OR REPLACE FUNCTION statement for Supabase migration runner.
-- Both the subscription, initial payment and idempotency receipt commit or roll back together.
-- Per-member advisory lock serializes concurrent create / renew operations.
CREATE OR REPLACE FUNCTION public.atom_create_subscription_idempotent(
  p_payload jsonb, p_actor_id uuid, p_request_key uuid, p_request_hash text, p_operation text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_id uuid;
  v_previous uuid;
  v_member_id uuid;
  v_plan text;
  v_type text;
  v_status text;
  v_amount numeric(10,2);
  v_due numeric(10,2);
  v_method text;
  v_paid_at timestamptz;
  v_start date;
  v_end date;
  v_total integer;
  v_used integer;
  v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
  v_latest_end date;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' OR p_actor_id IS NULL
     OR p_request_key IS NULL OR p_operation NOT IN ('create','renew')
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENT_SUBSCRIPTION_INPUT';
  END IF;

  v_member_id := (p_payload->>'member_id')::uuid;
  IF v_member_id IS NULL THEN RAISE EXCEPTION 'INVALID_MEMBER_ID'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('atom-subscription:' || v_member_id::text, 0));

  -- Return committed outcome before applying any new time-based checks.
  v_previous := public.atom_subscription_idempotency_lookup(
    p_request_key, p_operation, v_member_id, p_actor_id, p_request_hash
  );
  IF v_previous IS NOT NULL THEN
    RETURN jsonb_build_object('subscription_id', v_previous, 'replayed', true);
  END IF;

  v_plan := p_payload->>'plan';
  v_type := p_payload->>'subscription_type';
  v_status := p_payload->>'status';
  v_amount := (p_payload->>'amount')::numeric(10,2);
  v_due := (p_payload->>'amount_due')::numeric(10,2);
  v_method := p_payload->>'payment_method';
  v_paid_at := (p_payload->>'paid_at')::timestamptz;
  v_start := (p_payload->>'start_date')::date;
  v_end := (p_payload->>'end_date')::date;
  v_total := (p_payload->>'sessions_total')::integer;
  v_used := (p_payload->>'sessions_used')::integer;

  IF v_plan NOT IN ('1w','1m','3m','6m','12m') OR v_type <> 'time'
    OR v_status <> 'active' OR v_amount IS NULL OR v_amount < 0
    OR v_due IS NULL OR v_due < 0 OR v_paid_at IS NULL
    OR v_start IS NULL OR v_end IS NULL OR v_end < v_start
    OR v_method NOT IN ('cash','instapay','card','bank_transfer')
    OR v_total IS NOT NULL OR v_used IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENT_SUBSCRIPTION_INPUT';
  END IF;

  IF p_operation = 'create' AND EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.member_id = v_member_id AND s.status = 'active'
      AND (s.end_date IS NULL OR s.end_date >= v_today)
      AND (s.subscription_type <> 'sessions' OR
           coalesce(s.sessions_total,0) > coalesce(s.sessions_used,0))
  ) THEN
    RAISE EXCEPTION 'ACTIVE_SUBSCRIPTION_EXISTS' USING ERRCODE = '23505';
  END IF;

  IF p_operation = 'renew' THEN
    SELECT max(s.end_date) INTO v_latest_end
    FROM public.subscriptions s
    WHERE s.member_id = v_member_id AND s.status = 'active'
      AND s.subscription_type = 'time' AND s.end_date >= v_today;
    IF v_latest_end IS NOT NULL AND v_start <= v_latest_end THEN
      RAISE EXCEPTION 'RENEWAL_START_OVERLAP' USING ERRCODE = '23505';
    END IF;
  END IF;

  -- Fail closed for any missing current active required document version.
  -- Keep version identity consistent with the API's getMemberLegalCompliance check.
  IF EXISTS (
    SELECT 1
    FROM public.legal_document_versions d
    WHERE d.status = 'active' AND d.is_required = true
      AND NOT EXISTS (
        SELECT 1
        FROM public.member_legal_acceptances a
        WHERE a.member_user_id = v_member_id
          AND a.document_version_id = d.id
      )
  ) THEN
    RAISE EXCEPTION 'LEGAL_CONSENT_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.subscriptions (
    member_id, plan, subscription_type, status, amount, amount_due,
    payment_method, paid_at, start_date, end_date, sessions_total, sessions_used
  ) VALUES (
    v_member_id, v_plan, v_type, v_status, v_amount, v_due,
    v_method, v_paid_at, v_start, v_end, v_total, v_used
  ) RETURNING id INTO v_id;

  IF v_amount > 0 THEN
    INSERT INTO public.subscription_payments (
      subscription_id, member_id, amount, payment_method, paid_at, note, created_by
    ) VALUES (
      v_id, v_member_id, v_amount, v_method, v_paid_at, 'Initial payment', p_actor_id
    );
  END IF;

  INSERT INTO public.atom_subscription_idempotency (
    request_key, operation, member_id, actor_id, request_hash, subscription_id
  ) VALUES (p_request_key, p_operation, v_member_id, p_actor_id, p_request_hash, v_id);

  RETURN jsonb_build_object('subscription_id', v_id, 'replayed', false);
END;
$$;
