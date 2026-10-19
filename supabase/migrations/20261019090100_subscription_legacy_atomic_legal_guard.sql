-- Functional 1C.5B.3B: DB-side legal consent guard; preserves existing function grants.
-- A single CREATE OR REPLACE FUNCTION statement for Supabase migration runner.
-- Functional 1C.5A.1: Subscription and initial payment history are one transaction.
-- RPC is service_role-only. The API retains authentication, RBAC and legal-consent checks.
-- One top-level SQL statement for Supabase prepared migration runner.
CREATE OR REPLACE FUNCTION public.atom_create_subscription_with_initial_payment(
  p_payload jsonb,
  p_actor_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_id uuid;
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
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ATOMIC_SUBSCRIPTION_INPUT';
  END IF;

  v_member_id := (p_payload->>'member_id')::uuid;
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

  IF v_member_id IS NULL OR v_plan IS NULL OR v_type NOT IN ('time','sessions')
    OR v_status <> 'active' OR v_amount IS NULL OR v_amount < 0
    OR v_due IS NULL OR v_due < 0 OR v_paid_at IS NULL
    OR v_start IS NULL OR v_end IS NULL OR v_end < v_start
    OR v_method NOT IN ('cash','instapay','card','bank_transfer') THEN
    RAISE EXCEPTION 'INVALID_ATOMIC_SUBSCRIPTION_INPUT';
  END IF;

  IF v_type = 'time' AND (v_total IS NOT NULL OR v_used IS NOT NULL) THEN
    RAISE EXCEPTION 'INVALID_TIME_SUBSCRIPTION_SESSIONS';
  END IF;

  IF v_type = 'sessions' AND (v_total IS NULL OR v_total < 1 OR v_used IS NULL OR v_used <> 0) THEN
    RAISE EXCEPTION 'INVALID_SESSION_SUBSCRIPTION_INPUT';
  END IF;

  -- Let the database transaction enforce consistency. Errors from either INSERT
  -- abort the entire RPC, including all trigger effects; no compensating DELETE.
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

  RETURN v_id;
END;
$$;
