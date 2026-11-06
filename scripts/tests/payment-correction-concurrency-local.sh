#!/usr/bin/env bash
# Run only from the GitHub Actions isolated Supabase DB job, never on shared DB.
set -euo pipefail
DB_CONTAINER="${1:-}"
if [[ -z "$DB_CONTAINER" || "$DB_CONTAINER" != "$(docker ps --filter 'name=supabase_db_' --format '{{.ID}}' | head -n 1)" ]]; then
  echo "Expected the isolated local Supabase DB container ID" >&2
  exit 1
fi
PSQL=(docker exec -i "$DB_CONTAINER" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1)
"${PSQL[@]}" < scripts/tests/payment-correction-concurrency-fixture-local.sql
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
# Session A takes the same batch lock as the amount correction RPC and holds
# it while session B attempts the method correction against the stale batch.
# Two separate docker exec => separate PostgreSQL backend connections.
cat > "$WORKDIR/a.sql" <<'SQL'
\set ON_ERROR_STOP on
SET lock_timeout = '10s';
SET statement_timeout = '20s';
BEGIN;
SELECT id FROM public.payment_validation_batches
WHERE id='b173c140-164d-486e-a016-f039e7f02005' FOR UPDATE;
\echo SESSION_A_BATCH_LOCK_ACQUIRED
SELECT pg_sleep(4);
SELECT public.correct_and_revalidate_payment_v1(
'b173c140-164d-486e-a016-f039e7f02005',
'subscription_payment',
'b173c140-164d-486e-a016-f039e7f02004',
2200,2100,2100,'Concurrent amount correction test',
'b173c140-164d-486e-a016-f039e7f02001');
COMMIT;
SQL
"${PSQL[@]}" < "$WORKDIR/a.sql" > "$WORKDIR/a.log" 2>&1 &
a_pid=$!
# Wait for the first connection to report the batch lock before starting B.
locked=0
for i in $(seq 1 100); do
  if grep -q 'SESSION_A_BATCH_LOCK_ACQUIRED' "$WORKDIR/a.log"; then locked=1; break; fi
  if ! kill -0 "$a_pid" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ "$locked" != "1" ]]; then
  cat "$WORKDIR/a.log" >&2
  wait "$a_pid" || true
  echo "Session A never acquired the expected batch lock" >&2
  exit 1
fi
set +e
"${PSQL[@]}" > "$WORKDIR/b.log" 2>&1 <<'SQL'
\set ON_ERROR_STOP on
SET lock_timeout = '10s';
SET statement_timeout = '20s';
SELECT * FROM public.correct_subscription_payment_method_v1(
'b173c140-164d-486e-a016-f039e7f02004',
'card','instapay','Concurrent stale method correction',
'b173c140-164d-486e-a016-f039e7f02001');
SQL
b_result=$?
wait "$a_pid"
a_result=$?
set -e
echo "=== Session A: amount ==="
cat "$WORKDIR/a.log"
echo "=== Session B: method ==="
cat "$WORKDIR/b.log"
if [[ "$a_result" != "0" ]]; then
  echo "Amount correction failed in isolated concurrency test" >&2
  exit 1
fi
if [[ "$b_result" == "0" ]]; then
  echo "Stale method correction unexpectedly succeeded" >&2
  exit 1
fi
# Do not accept generic deadlock/timeout/connection errors as a passing guard.
if grep -Eqi 'deadlock detected|lock timeout|statement timeout|canceling statement' "$WORKDIR/b.log"; then
  echo "Concurrent operation deadlocked or timed out" >&2
  exit 1
fi
if ! grep -Eq 'Validation batch changed|Historical or changed validation batch|Payment validation link changed' "$WORKDIR/b.log"; then
  echo "Method correction was not rejected by expected stale validation guard" >&2
  exit 1
fi
# Verify no duplicate revenue; the amount correction is committed, method isn't.
"${PSQL[@]}" <<'SQL'
\set ON_ERROR_STOP on
DO $$
DECLARE
  v_amount numeric;
  v_due numeric;
  v_method text;
  v_batch_count integer;
  v_new_batch_count integer;
  v_correction_count integer;
BEGIN
  SELECT amount,payment_method INTO v_amount,v_method FROM public.subscription_payments
    WHERE id='b173c140-164d-486e-a016-f039e7f02004';
  SELECT amount_due INTO v_due FROM public.subscriptions
    WHERE id='b173c140-164d-486e-a016-f039e7f02003';
  SELECT count(*) INTO v_batch_count FROM public.payment_validation_batches
    WHERE id='b173c140-164d-486e-a016-f039e7f02005' AND deleted_at IS NOT NULL;
  SELECT count(*) INTO v_new_batch_count FROM public.payment_validation_batches
    WHERE id <> 'b173c140-164d-486e-a016-f039e7f02005'
      AND payment_method='card' AND business_date='2026-10-29'
      AND expected_amount=2100 AND deleted_at IS NULL;
  SELECT count(*) INTO v_correction_count FROM public.subscription_payment_method_corrections
    WHERE payment_id='b173c140-164d-486e-a016-f039e7f02004';
  IF v_amount <> 2100 OR v_method <> 'card' OR v_due <> 100
     OR v_batch_count <> 1 OR v_new_batch_count <> 1 OR v_correction_count <> 0 THEN
    RAISE EXCEPTION 'CONCURRENT_CORRECTION_FINANCIAL_INVARIANT_FAILED';
  END IF;
  RAISE NOTICE 'AMOUNT_VS_METHOD_TWO_SESSION_PASS';
END
$$;
SQL
