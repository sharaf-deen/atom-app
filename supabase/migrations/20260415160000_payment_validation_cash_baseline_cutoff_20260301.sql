-- Payments reconciliation cash baseline cutoff
-- Purpose: close legacy open cash entries before 2026-03-01 so the first open cash scope starts on 2026-03-01.
-- This is implemented as an explicit baseline validation batch, not as a hidden UI/date filter.

begin;

DO $$
DECLARE
  v_cutoff_date constant date := date '2026-03-01';
  v_note constant text := 'Legacy cash baseline through 2026-02-28 (cutoff 2026-03-01)';
  v_actor uuid;
  v_batch_id uuid;
  v_first_event_at timestamptz;
  v_last_event_at timestamptz;
  v_expected_amount numeric(12,2);
  v_item_count integer;
BEGIN
  -- Be cautious and idempotent: if the baseline batch already exists and is still active, do nothing.
  SELECT b.id
  INTO v_batch_id
  FROM public.payment_validation_batches b
  WHERE b.payment_method = 'cash'
    AND b.validation_mode = 'cash_period'
    AND b.note = v_note
    AND b.deleted_at IS NULL
  ORDER BY b.created_at DESC
  LIMIT 1;

  IF v_batch_id IS NOT NULL THEN
    RETURN;
  END IF;

  -- Optional attribution when a super admin profile exists.
  SELECT p.user_id
  INTO v_actor
  FROM public.profiles p
  WHERE p.role = 'super_admin'
  ORDER BY p.created_at ASC NULLS LAST, p.user_id ASC
  LIMIT 1;

  SELECT
    min(e.event_at),
    max(e.event_at),
    coalesce(sum(e.amount), 0)::numeric(12,2),
    count(*)
  INTO
    v_first_event_at,
    v_last_event_at,
    v_expected_amount,
    v_item_count
  FROM public.admin_income_events_open_v1 e
  WHERE e.payment_method_norm = 'cash'
    AND e.business_date < v_cutoff_date;

  -- Nothing to baseline.
  IF coalesce(v_item_count, 0) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.payment_validation_batches (
    payment_method,
    validation_mode,
    business_date,
    period_from,
    period_to,
    expected_amount,
    counted_amount,
    difference_amount,
    note,
    validated_by,
    validated_at,
    created_by,
    updated_by
  )
  VALUES (
    'cash',
    'cash_period',
    NULL,
    v_first_event_at,
    GREATEST(v_last_event_at + interval '1 second', v_first_event_at + interval '1 second'),
    v_expected_amount,
    v_expected_amount,
    0,
    v_note,
    v_actor,
    now(),
    v_actor,
    v_actor
  )
  RETURNING id INTO v_batch_id;

  INSERT INTO public.payment_validation_batch_items (
    batch_id,
    source_kind,
    source_id,
    amount_snapshot,
    business_date_snapshot,
    event_at_snapshot,
    created_by
  )
  SELECT
    v_batch_id,
    e.source_kind,
    e.source_id,
    e.amount,
    e.business_date,
    e.event_at,
    v_actor
  FROM public.admin_income_events_open_v1 e
  WHERE e.payment_method_norm = 'cash'
    AND e.business_date < v_cutoff_date;
END
$$;

commit;
