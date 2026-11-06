# ATOM — Subscription Payment Integrity + Security Hardening 1F: Production Integration Readiness

**Status: DRAFT / PRODUCTION NO-GO**
**Scope:** Issue #1341, Finance PR #1344, Staging integration PR #1349 and parallel Security Hardening 1F migrations.

## Verified functionality (Staging only)

- Super Admin payment method correction: PASS via actual UI submission, test member ATOM-000011 (EGP 1,000 Cash -> InstaPay).
- Paid amount/due unchanged, exact audit row with actor, old/new method and reason: PASS.
- Manual new daily InstaPay Payment Validation: PASS, EGP 1,000 expected / EGP 1,000 counted / EGP 0 difference; exactly one validation item.
- Historical *already validated* batch re-correction: PASS via real Staging RPC inside a rolled-back transaction; original validation batch and item released inside transaction; payment available for revalidation under new method; after ROLLBACK original live payment, batch, and audit unchanged.
- CI and database reset/smoke tests: PASS on finance branch.
- Does not prove live bank statement matching for this fictional payment. Do not import or match real bank statements for a test.

## Integration risk at inspection (2026-11-06)

- `main` and `staging` have materially diverged: ahead 178, behind 278; 127 differing files.
- **Do NOT merge `staging` wholesale into `main`.** Do NOT simply merge finance PR #1344 without reviewing its dependencies on newer Security Hardening migrations/code.
- **15 migration versions** exist in Staging Supabase but are absent from Production Supabase:
  1. `20261106133214` Security Hardening 1F financial table permissions
  2. `20261106141806` 1F4 privileged RPC anon revokes
  3. `20261106142641` 1F4 payroll RPC grants
  4. `20261106143841` 1F4 store/coaching RPC grants
  5. `20261106144901` 1F5 payroll mutation grants
  6. `20261106145952` 1F6 coaching grants
  7. `20261106150006` 1F6 coaching booking grants
  8. `20261106150015` 1F6 coaching payroll grants
  9. `20261106151433` 1F7 internal RPC grants
  10. `20261106155207` 1F8 legacy member search/store stats grants
  11. `20261106160000` subscription payment method correction
  12. `20261106201914` 1F9 authenticated workflows/anon revokes
  13. `20261106202849` 1F10 payroll helper RPC grants
  14. `20261106203019` 1F10 financial view anon revoke
  15. `20261106204551` 1F11 financial open view invoker/server-only
- The matching migration file for **`20261106204551` was missing from the `staging` Git tree** at inspection; it must be reconciled in the source branch before release. Never invent its SQL contents or mark it applied manually.

## Integrated release gates (single batch)

1. **Freeze a release candidate SHA** and reconcile the missing 1F11 migration file and all outstanding 1F migrations from the actual Staging migration history. Verify exact content, order, checksum / no drift and required source APIs.
2. **Selectively integrate** reviewed code + migrations into a branch off current `main`. No automatic full branch merge; resolve `main`/Staging implementation conflicts explicitly, particularly auth, accounting, staff payroll, payment-validation, and subscription update APIs.
3. **CI + DB tests** on the *integration branch* (not only finance feature branch): build, typecheck, unit tests, isolated DB Reset + Smoke, concurrency regressions and RLS/grant checks.
4. **Deploy integrated candidate to a separate, safe Staging environment or approved equivalent**, apply migrations in version order, run full Super Admin + member-facing regression (login/search/profile/QR/payments/refunds/expenses/payroll/correction/revalidation). Do not overwrite live Staging without coordination.
5. **Review finance effects**: audit append-only, old validation release, revalidation, no doubled revenue, bank-match/refund/multi-entry batch protection; validate accounting totals before/after.
6. Confirm **rollback & database backup plan**, monitoring, migration immutability, and capture explicit Production approval. Apply DB migrations before routing application traffic if required by compatibility, then verify production deployment and non-regressions.

**This draft PR is only a coordination document. It contains no migration/code changes, performs no Supabase Production operation, and does not authorize Production deployment.**
