# Subscription Payment Integrity — implementation plan

GitHub issue: #1341. Branch: `fix/subscription-payment-integrity`.

## Confirmed failure

`src/app/api/subscriptions/update/route.ts` accepts patches to `subscriptions.amount`, `subscriptions.amount_due`, and `subscriptions.payment_method`, but does not update the ledger row in `subscription_payments` or revalidate existing Payment Validation batches. Historical snapshot state therefore can disagree with the subscription card.

Production reproduction (read only): Aly Gehad / ATOM-000393, 29 October 2026: subscription lists InstaPay, initial payment ledger and validated batch say Card (EGP 2,200). The sender of the corresponding CIB InstaPay credit was separately confirmed as a third party. No Production data should be mutated by this branch.

## Relevant existing mechanisms

- `supabase/migrations/20260919101000_reconciliation_revalidate_and_access.sql`: `correct_and_revalidate_payment_v1` already supports **amount corrections** to a uniquely selected payment in a validated batch, with locks, audit history, protection against active bank matches and refund workflows.
- The current amount-only RPC rejects unchanged amounts; it cannot repair a method-only error.
- Subscription creation/settlement and installment records must keep their independent amounts and payment methods. Do not blindly synchronize every payment to the subscription header.

## Proposed implementation order

1. Add a **read-only reconciliation diagnostic** identifying individual initial payment rows whose amount/method disagree with the subscription header, indicating ambiguity where more than one payment exists. No automatic backfill.
2. Add a **super-admin-only payment correction workflow** keyed by `subscription_payments.id`. Require old-value preconditions, reason, authorization, atomic transaction and audit. Differentiate amount correction from method correction.
3. For a validated payment, revalidate old and new day/method scopes and preserve superseded validation evidence; refuse changes if linked bank matches must be released. Existing amount-correction RPC can be reused after assessing behavior. Do not remove matched bank evidence or mutate old audit snapshots.
4. Route subscription finance edits through the controlled ledger correction flow when a single specific payment is identified. Reject ambiguous updates and display a clear choice of payment row. Keep non-financial edits independent.
5. Recompute header amount/due from authoritative ledger invariants, not by copying the edited installment to every payment. Confirm invoice and refund safeguards.
6. Test in an isolated environment, then Staging only when Security Hardening work is not deploying to the same shared environment.

## Required regression tests

| Scenario | Expected |
|---|---|
| One initial payment: Card → InstaPay | Only targeted payment changes; new validated InstaPay batch; old Card batch superseded; unchanged amount |
| Amount correction: 2,200 → 2,500 | Ledger and subscription financial totals consistent; no duplicated credit |
| Multiple installments with mixed methods | Other installments untouched; total paid/due accurate |
| Validated batch with bank match | Correction blocked pending audited release |
| Membership with paid refund | Correction blocked or explicitly reconciled by refund-safe workflow |
| Retry same request | No duplicate ledger lines or batches |
| Concurrent edits | One succeeds; stale edit fails with conflict |
| Existing evidence/proof | Old snapshot and actor/reason retained |
| Historical records | Read-only report identifies candidates, never changes them |

## Release gates

- No Production writes during design and testing.
- No merge or shared Staging migration during parallel security work without coordination.
- Lint/typecheck/test on branch; isolated DB race checks; Staging functional checks; reviewed PR; scheduled merge after security change freeze.
