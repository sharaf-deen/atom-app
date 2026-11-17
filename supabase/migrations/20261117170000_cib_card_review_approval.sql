-- CIB merchant card reconciliation is an evidence-backed review ledger, not a financial posting.
CREATE TABLE IF NOT EXISTS public.cib_card_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  terminal_batch text NOT NULL,
  transaction_date date NOT NULL,
  settlement_date date NOT NULL,
  approval_code text NOT NULL,
  gross_cents bigint NOT NULL CHECK (gross_cents > 0),
  transaction_key text NOT NULL,
  evidence_note text NOT NULL CHECK (length(trim(evidence_note)) >= 12),
  approved_by uuid NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  released_by uuid,
  release_reason text,
  CHECK ((released_at IS NULL AND released_by IS NULL AND release_reason IS NULL)
    OR (released_at IS NOT NULL AND released_by IS NOT NULL AND length(trim(coalesce(release_reason,''))) >= 12))
);
CREATE TABLE IF NOT EXISTS public.cib_card_approval_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id uuid NOT NULL REFERENCES public.cib_card_approvals(id) ON DELETE RESTRICT,
  source_kind text NOT NULL CHECK (source_kind IN ('subscription','store','other_income')),
  source_id uuid NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  released_at timestamptz,
  UNIQUE (approval_id,source_kind,source_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS cib_card_approvals_active_transaction_key
  ON public.cib_card_approvals(transaction_key) WHERE released_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cib_card_approval_items_unique_source_active
  ON public.cib_card_approval_items(source_kind,source_id)
  WHERE released_at IS NULL;
-- Released source links remain auditable but become eligible for a reviewed replacement.
CREATE INDEX IF NOT EXISTS cib_card_approvals_recent ON public.cib_card_approvals(approved_at DESC);

ALTER TABLE public.cib_card_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cib_card_approval_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cib_card_approvals,public.cib_card_approval_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.cib_card_approvals,public.cib_card_approval_items TO service_role;

CREATE OR REPLACE FUNCTION public.cib_card_approve(
  p_batch text, p_transaction_date date, p_settlement_date date,
  p_approval_code text, p_gross_cents bigint, p_items jsonb,
  p_evidence_note text, p_actor uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key text;
  v_approval uuid;
  v_item jsonb;
  v_kind text;
  v_id uuid;
  v_cents bigint;
  v_date date;
  v_method text;
  v_amount bigint;
  v_sum bigint := 0;
  v_count int := 0;
BEGIN
  -- Serialize approvals globally; unique indexes additionally prevent duplicates.
  PERFORM pg_advisory_xact_lock(487734, 202610);
  IF p_actor IS NULL OR p_transaction_date IS NULL OR p_settlement_date IS NULL
    OR p_gross_cents IS NULL OR p_gross_cents <= 0
    OR p_settlement_date < p_transaction_date OR p_settlement_date > p_transaction_date + 15
    OR p_batch !~ '^28276801(_[0-9]{6}|M[0-9]{6})$'
    OR length(trim(coalesce(p_approval_code,''))) < 3
    OR length(trim(coalesce(p_evidence_note,''))) < 12
    OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'INVALID_APPROVAL_REQUEST';
  END IF;
  v_key := md5(p_batch||'|'||p_transaction_date::text||'|'||upper(trim(p_approval_code))||'|'||p_gross_cents::text);
  IF EXISTS(SELECT 1 FROM public.cib_card_approvals
      WHERE transaction_key=v_key AND released_at IS NULL) THEN
    RAISE EXCEPTION 'CIB_TRANSACTION_ALREADY_APPROVED';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_kind := v_item->>'source';
    v_id := (v_item->>'id')::uuid;
    v_count := v_count + 1;
    IF v_kind = 'subscription' THEN
      SELECT round(amount*100)::bigint, (paid_at AT TIME ZONE 'Africa/Cairo')::date, payment_method
      INTO v_amount,v_date,v_method FROM public.subscription_payments WHERE id=v_id;
    ELSIF v_kind = 'store' THEN
      SELECT paid_cents::bigint,purchase_date,payment_method
      INTO v_amount,v_date,v_method FROM public.store_sales WHERE id=v_id AND status='paid';
    ELSIF v_kind = 'other_income' THEN
      SELECT round(amount*100)::bigint,entry_date,payment_method
      INTO v_amount,v_date,v_method FROM public.external_income_entries WHERE id=v_id;
    ELSE
      RAISE EXCEPTION 'INVALID_SOURCE';
    END IF;
    IF v_amount IS NULL OR v_amount <= 0 OR v_method IS DISTINCT FROM 'card'
      OR v_date IS NULL OR abs(v_date-p_transaction_date)>1 THEN
      RAISE EXCEPTION 'SOURCE_NOT_ELIGIBLE';
    END IF;
    IF EXISTS(SELECT 1 FROM public.cib_card_approval_items
      WHERE source_kind=v_kind AND source_id=v_id AND released_at IS NULL) THEN
      RAISE EXCEPTION 'SOURCE_ALREADY_USED';
    END IF;
    v_sum := v_sum + v_amount;
  END LOOP;
  IF v_sum <> p_gross_cents THEN
    RAISE EXCEPTION 'GROSS_AMOUNT_MISMATCH';
  END IF;
  INSERT INTO public.cib_card_approvals (
    terminal_batch,transaction_date,settlement_date,approval_code,gross_cents,
    transaction_key,evidence_note,approved_by
  ) VALUES (
    p_batch,p_transaction_date,p_settlement_date,upper(trim(p_approval_code)),p_gross_cents,
    v_key,trim(p_evidence_note),p_actor
  ) RETURNING id INTO v_approval;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_kind := v_item->>'source';
    v_id := (v_item->>'id')::uuid;
    IF v_kind='subscription' THEN
      SELECT round(amount*100)::bigint INTO v_cents FROM public.subscription_payments WHERE id=v_id;
    ELSIF v_kind='store' THEN
      SELECT paid_cents::bigint INTO v_cents FROM public.store_sales WHERE id=v_id;
    ELSE
      SELECT round(amount*100)::bigint INTO v_cents FROM public.external_income_entries WHERE id=v_id;
    END IF;
    INSERT INTO public.cib_card_approval_items(approval_id,source_kind,source_id,amount_cents)
    VALUES(v_approval,v_kind,v_id,v_cents);
  END LOOP;
  RETURN v_approval;
END $$;
REVOKE ALL ON FUNCTION public.cib_card_approve(text,date,date,text,bigint,jsonb,text,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cib_card_approve(text,date,date,text,bigint,jsonb,text,uuid) TO service_role;

-- No deletion of evidence. Release retains the historical allocation snapshot.
CREATE OR REPLACE FUNCTION public.cib_card_release(p_id uuid,p_reason text,p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF p_actor IS NULL OR length(trim(coalesce(p_reason,''))) < 12 THEN
    RAISE EXCEPTION 'INVALID_RELEASE_REQUEST';
  END IF;
  UPDATE public.cib_card_approvals
  SET released_at=now(),released_by=p_actor,release_reason=trim(p_reason)
  WHERE id=p_id AND released_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'APPROVAL_NOT_ACTIVE'; END IF;
  UPDATE public.cib_card_approval_items SET released_at=now()
  WHERE approval_id=p_id AND released_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.cib_card_release(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cib_card_release(uuid,text,uuid) TO service_role;
