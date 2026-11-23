# ATOM Complimentary Extension — Staging preflight report (2026-11-23)

PR #1431 / Issue #1430. **This is a PRE-IMPLEMENTATION baseline report, not a feature test pass.**

## Environment
- Supabase staging project: `ovaxewmlwueixjxqczyg` (`atomjj-staging`).
- Status: `ACTIVE_HEALTHY` after successful restore.
- Supabase production project `bapeppmkrtplhhnabgko`: no write operations performed.
- PR #1431 currently contains architecture documentation only; no feature migration/API/UI exists.

## Executed read-only SQL assertions

| Check | Observed |
|---|---|
| subscriptions table exists | PASS |
| subscription_freezes table exists | PASS |
| membership_refunds table exists | PASS |
| subscription_payments table exists | PASS |
| subscriptions RLS enabled | PASS |
| apply_membership_upgrade_v1 RPC exists | PASS |
| manage_subscription_freeze_atomic RPC exists | PASS |
| apply_membership_refund_impact_atomic RPC exists | PASS |
| complimentary grant function exists | NOT IMPLEMENTED |
| subscription_complimentary_grants table exists | NOT IMPLEMENTED |

The last two are expected failed **feature readiness** checks, not regression tests.

## Function dependency audit
Read-only function introspection confirms all of the following PL/pgSQL functions refer to `end_date`:
- `apply_membership_upgrade_v1` (also references amount).
- `manage_subscription_freeze_atomic`.
- `apply_membership_refund_impact_atomic` (also references amount).
- `expire_subscriptions`.

Their implementations must be reviewed in full and covered by integration tests before changing expiry semantics. Existing branch drift: `main` has Subscription Edit hardening files from PR #1428, but `staging` inspected before implementation lacks them.

## Functional test status
- Grant 7 days, duplicate idempotency, concurrent calls: **NOT RUN** (feature absent).
- Financial invariant / upgrade credit / refund immutability: **NOT RUN** (feature absent).
- AuthZ role matrix: **NOT RUN** (feature absent).
- Freeze/renewal/refund interactions: **NOT RUN** (feature absent).
- Typecheck, CI, DB reset: **NOT RUN**.

## Release gate
**DO NOT MERGE** or claim acceptance tests pass. Next work is actual implementation against reconciled branch migrations, followed by isolated Staging scenarios with cleanup and verifiable evidence. No production change was made.
