-- Read-only audit: header/ledger discrepancies for subscription payments.
-- Run with a read-only database role. Never use this output for automatic updates.
-- 'single_payment_mismatch' means there is exactly one ledger row for the
-- subscription and its amount/method differs from the subscription header.
-- 'multiple_payments_review' requires manual inspection: mixed methods and
-- amounts are legitimate for split or installment payments.
WITH payment_summary AS (
  SELECT
    sp.subscription_id,
    count(*)::integer AS payment_count,
    coalesce(sum(sp.amount), 0)::numeric(12,2) AS ledger_total,
    min(sp.payment_method) AS only_method,
    min(sp.amount) AS only_amount,
    count(DISTINCT sp.payment_method)::integer AS distinct_methods
  FROM public.subscription_payments sp
  GROUP BY sp.subscription_id
)
SELECT
  s.id AS subscription_id,
  p.member_id AS atom_member_id,
  s.plan,
  s.status AS subscription_status,
  s.amount AS header_paid_amount,
  s.amount_due AS header_due_amount,
  s.payment_method AS header_payment_method,
  ps.payment_count,
  ps.ledger_total,
  CASE WHEN ps.payment_count = 1 THEN ps.only_amount ELSE NULL END AS sole_payment_amount,
  CASE WHEN ps.payment_count = 1 THEN ps.only_method ELSE NULL END AS sole_payment_method,
  CASE
    WHEN ps.payment_count = 1 AND
      (ps.ledger_total IS DISTINCT FROM s.amount
       OR ps.only_method IS DISTINCT FROM s.payment_method)
    THEN 'single_payment_mismatch'
    WHEN ps.payment_count > 1 AND ps.ledger_total IS DISTINCT FROM s.amount
    THEN 'multiple_payments_review'
    ELSE 'no_simple_mismatch'
  END AS audit_status
FROM public.subscriptions s
JOIN payment_summary ps ON ps.subscription_id = s.id
LEFT JOIN public.profiles p ON p.user_id = s.member_id
WHERE (ps.payment_count = 1 AND
       (ps.ledger_total IS DISTINCT FROM s.amount
        OR ps.only_method IS DISTINCT FROM s.payment_method))
   OR (ps.payment_count > 1 AND ps.ledger_total IS DISTINCT FROM s.amount)
ORDER BY audit_status, p.member_id, s.id;

-- Scope note: this is a candidate report only. Historical refunds, legacy
-- mutations, cash adjustments, and other special financial operations may
-- explain discrepancies; compare against source events before correction.
