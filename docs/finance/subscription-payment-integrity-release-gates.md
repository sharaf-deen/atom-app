# Subscription Payment Integrity — consolidated release gates

Status: **Staging validation incomplete. Production NO-GO.**
Issue #1341. Main functional PR #1344. Staging integration PR #1349 (merged).

## Confirmed
- CI and ephemeral local PostgreSQL DB reset/smoke on finance branch: PASS.
- Isolated tests: single entry method correction, stale retry, mixed installment isolation, refunds guard, active bank-match guard, multi-entry batch protection, two concurrent PostgreSQL sessions.
- Staging Supabase migration `20261106160000_subscription_payment_method_correction` installed.
- Staging RPC `correct_subscription_payment_method_v1` and audit table present.
- Service-role EXECUTE permitted; `anon` / `authenticated` EXECUTE denied.
- Authenticated role may SELECT audit only through RLS; INSERT not granted.
- Staging Super Admin UI shows correction modal, no-payment condition and payment picker.
- Staging read-only audit review showed **0 correction records** as of 2026-11-06.
- Production release not performed.

## Final consolidated verification — 2026-11-06
**Decision: STAGING TECHNICAL PASS / PRODUCTION NO-GO.**

Verified directly:
- The current `staging` SHA `57c0b74cd3e521a56c7c67e812d106bbb2e066c1` has a Vercel deployment in state `READY`.
- PR #1344 commit `ab772d57f2f369e076187be66807c9f20b6a7649`: CI PASS; DB Reset + Smoke PASS.
- Staging's method correction SQL migration is installed precisely once; function and audit table exist, RLS enabled, only service_role can execute the privileged correction RPC, and authenticated cannot insert audit events.
- Audit table count remains **0**: no real Staging correction has been accepted/executed. Picking a payment in the UI only proves the selection flow, NOT end-to-end mutation, audit or manual revalidation.
- Supabase Staging migration ledger has **11 versions not in Production**, specifically 10 Security Hardening 1F migrations plus the payment method correction migration. Do not merge the finance-only PR straight to main and assume this ordering is resolved.

Remaining explicit release blockers:
1. An authorized fictional Staging record with genuine ledger entry and controlled end-to-end correction, audit, validation/reconciliation verification. Run without touching real member funds.
2. Coordinate with Security Hardening to promote the complete set of reviewed migrations in order to main/Production; do not skip or repair migration history.
3. Explicit Production GO decision and its regression suite.

No Production migration, data mutation, or deployment was performed as part of this verification.

## Remaining **hard gates** before Production
1. Confirm current **latest** Staging Vercel deployment is READY and matches the current `staging` head (parallel Security Hardening changes may still be building).
2. Complete an **authorized actual correction** on a clearly identified **fictional Staging payment**, with verified pre-change ledger/batch/bank-link state; do not use real member funds.
3. Verify one correction audit row: exact payment ID, original/new method, reason, actor, original batch pointer; no change in payment amount or dues.
4. Verify original batch evidence remains traceable, the old validation is released, corrected source reappears in the correct method/date and must be revalidated manually. Confirm no orphan bank match or duplicate revenue.
5. Verify client-side and server-side negative cases in Staging: non-Super-Admin access refused; stale method retry rejected; matched bank/refund/multi-entry batch rejected without side effects.
6. Compare **current Staging migrations** and **current main/Production**; Security Hardening migrations may be absent from main, so a production release needs an ordered and reviewed migration plan. Never copy or force migration history repairs.
7. Production deployment only after explicit approval, then five non-regression checks (login, member search, profile, QR scan, financial pages) plus payment correction capability.

## Operator policy
- This document does NOT authorize any production operation.
- Never merge #1344 solely because its isolated CI passes.
- No real financial record may be modified for an acceptance test.
- Keep a snapshot of old/new payment and validation records for each test, never post sensitive member data in issue comments.
