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
