# ATOM Subscription — Complimentary Extension & Financial Integrity

Issue: #1430. Status: **design / integration audit only; NOT implemented; DO NOT DEPLOY**.

## Verified findings (2026-11-23)
- `public.subscriptions.end_date` is a DATE. Current schema has no separate paid-end / complimentary-access-end field.
- `public.subscription_freezes` tracks historical days; `public.membership_refunds` can record subscription-impact end-date changes.
- Current `/api/subscriptions/update` permits end-date changes only under existing edit integrity guards; it is not an appropriate channel for free days.
- The protected repository includes the subscription edit hardening on `main` (PR #1428); the `staging` branch inspected did **not** have all of its helper and documentation files. Sync/rebase strategy must be established before extending it.
- Connected `atomjj-staging` project `ovaxewmlwueixjxqczyg` is INACTIVE and rejects schema inspection; connected `atomjj-prod` `bapeppmkrtplhhnabgko` was inspected **read-only**.

## Architecture decision to validate with live source audit
Do not directly add days to `subscriptions.end_date` until financial read paths are mapped. A naïve end-date update may increase refund/upgrade prorated balance and may be reversed by renewal/freeze/refund calculations.

Recommended separation:
- immutable commercial/paid coverage basis (preserve existing contract snapshot and ledger),
- cumulative, auditable complimentary grants as independent records,
- access effective end derived via one canonical service/DB function, accounting for existing freeze extension behavior,
- disallow granting to cancelled/refunded memberships and prevent reversal from invalidating subsequent operations,
- ledger and monetary valuation **never** incorporate complimentary days.

## Implementation prerequisites
1. Get staging running and reconcile its migration history with the repository.
2. Inspect all `subscriptions.end_date` consumers: QR scan, member active status, upgrades, refunds, freeze create/clear, renewal, subscription edit, dashboards, invoices and payroll.
3. Confirm contract-time versus access-time semantics, including how grants persist through freeze/renewal and are canceled or transferred on refund.
4. Create a versioned migration (using Supabase CLI), RLS and transactional super-admin-only idempotent grant/reversal operations; secure against concurrent grants.
5. Implement validated server endpoint and member profile UI; wire canonical effective-end date in all access checks while preserving paid-only computations.
6. Run TypeScript, CI tests, local DB reset and staging integration tests. Confirm no paid ledger, invoices, refunds or payroll records change.
7. Only after actual test evidence open release review; no production deployment without approval.

## Acceptance gates
- Super Admin only at DB and API layers.
- Valid positive integer days, reason mandatory, replay idempotent.
- Multiple and concurrent grants accumulate correctly, audit append-only.
- Reversal preserves audit and refuses if unsafe.
- Effective member access extended exactly N days; renewal/freeze interactions verified.
- Upgrades, refunds and accounting valuations unchanged.
- No payment, invoice or commission records created.
- Full proof in staging, migration rollback guidance and PR review.

This is an implementation plan only and **does not provide any live Grant Extra Days action**.
