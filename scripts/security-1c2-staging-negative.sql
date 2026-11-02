-- Security Hardening 1C.2 — SAFE negative-path SQL regression
-- Run ONLY on Staging / an isolated DB; NEVER as a database migration.
-- All test identities and resource identifiers are random and not persisted.
-- A transaction is explicitly rolled back even if all assertions pass.
-- This tests rejection paths, NOT successful money/subscription mutations.
BEGIN;

DO $test$
DECLARE
  v_actor uuid := gen_random_uuid();
  v_target uuid := gen_random_uuid();
  v_code text;
BEGIN
  BEGIN
    PERFORM public.manage_subscription_freeze_atomic(
      v_target, 'create', NULL, CURRENT_DATE, CURRENT_DATE + 7, v_actor
    );
    RAISE EXCEPTION 'FAIL: freeze accepted an unknown actor';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
    IF v_code <> '42501' THEN RAISE EXCEPTION 'FAIL: unexpected freeze SQLSTATE %', v_code; END IF;
  END;

  BEGIN
    PERFORM public.apply_membership_refund_impact_atomic(
      v_target, 'keep_active', 'isolated security regression', NULL, v_actor
    );
    RAISE EXCEPTION 'FAIL: refund impact accepted an unknown actor';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
    IF v_code <> '42501' THEN RAISE EXCEPTION 'FAIL: unexpected refund SQLSTATE %', v_code; END IF;
  END;

  IF public.atom_subscription_idempotency_lookup(
    gen_random_uuid(), 'create', v_target, v_actor, repeat('a', 64)
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: unknown idempotency key matched a record';
  END IF;
END
$test$;

SELECT 'PASS: unauthorized freeze/refund rejected; idempotency lookup empty; transaction will roll back' AS result;

ROLLBACK;
