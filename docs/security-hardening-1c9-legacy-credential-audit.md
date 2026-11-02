# Security Hardening 1C.9 — Legacy Supabase Credential Dependency Inventory

## Status (2026-11-02)
**NO-GO: DO NOT REVOKE SUPABASE_SERVICE_ROLE_KEY.** This is a source-code audit, not a complete external dependency attestation.

An automated CI source scan identified **60 existing direct production-source references** to `SUPABASE_SERVICE_ROLE_KEY` (tracked in `scripts/security-1c9-legacy-baseline.json`). The central server client `src/lib/supabaseAdmin.ts` already prefers `SUPABASE_SECRET_KEY` and retains a temporary legacy fallback. The remaining direct references must be converted in small scope-controlled batches, with functional tests.

## Known inventory by workstream
### Payroll — 15
- `src/app/api/staff-payroll/accounting-export/route.ts`
- `src/app/api/staff-payroll/adjustments/route.ts`
- `src/app/api/staff-payroll/approval/route.ts`
- `src/app/api/staff-payroll/calculation/route.ts`
- `src/app/api/staff-payroll/catalog/route.ts`
- `src/app/api/staff-payroll/coaching-import/route.ts`
- `src/app/api/staff-payroll/dynamic-rates/route.ts`
- `src/app/api/staff-payroll/hybrid-approval/route.ts`
- `src/app/api/staff-payroll/hybrid-calculation/route.ts`
- `src/app/api/staff-payroll/monthly-task-log/route.ts`
- `src/app/api/staff-payroll/payment-closeout/route.ts`
- `src/app/api/staff-payroll/payments/route.ts`
- `src/app/api/staff-payroll/rates/route.ts`
- `src/app/api/staff-payroll/staff-profiles/route.ts`
- `src/app/api/staff-payroll/statements/[calculationId]/download/route.ts`

### Refunds — 4
- `src/app/api/membership-refunds/create/route.ts`
- `src/app/api/membership-refunds/proof/route.ts`
- `src/app/api/membership-refunds/update-status/route.ts`
- `src/app/api/membership-refunds/upload-proof/route.ts`

### MemberAndFamily — 6
- `src/app/admin/membership-activity/page.tsx`
- `src/app/admin/outstanding-dues/page.tsx`
- `src/app/api/members/[id]/invite-status/route.ts`
- `src/app/api/members/[id]/resend-invite/route.ts`
- `src/app/api/members/[id]/reset-password/route.ts`
- `src/app/api/members/create/route.ts`

### ExpensesAndPayments — 12
- `src/app/api/admin/cash-report/export-pdf/route.ts`
- `src/app/api/admin/cash-report/export/route.ts`
- `src/app/api/admin/external-income/[id]/attachment/route.ts`
- `src/app/api/admin/payments/export-pdf/route.ts`
- `src/app/api/admin/payments/export/route.ts`
- `src/app/api/admin/personal-funds/[id]/receipt/route.ts`
- `src/app/api/expenses/[id]/receipt/route.ts`
- `src/app/api/expenses/export-pdf/route.ts`
- `src/app/api/expenses/export/route.ts`
- `src/app/api/invoices/[id]/download/route.ts`
- `src/app/api/payments/reconciliation/bank-matching/route.ts`
- `src/app/api/payments/reconciliation/evidence/route.ts`

### CRM — 5
- `src/app/api/admin/crm/followups/route.ts`
- `src/app/api/admin/crm/templates/route.ts`
- `src/app/api/admin/prospects/import/route.ts`
- `src/app/api/admin/prospects/route.ts`
- `src/app/api/admin/prospects/templates/route.ts`

### Notifications — 4
- `src/app/api/admin/notify/run/route.ts`
- `src/app/api/notifications/audience-counts/route.ts`
- `src/app/api/notifications/delete/route.ts`
- `src/app/api/notifications/send/route.ts`

### FreezeRequests — 3
- `src/app/api/freeze-requests/cancel/route.ts`
- `src/app/api/freeze-requests/review/route.ts`
- `src/app/api/freeze-requests/route.ts`

### Other — 11
- `src/app/api/admin/audit/route.ts`
- `src/app/api/admin/find-member/route.ts`
- `src/app/api/admin/stats/revenue/route.ts`
- `src/app/api/coach-operations/programs/route.ts`
- `src/app/api/contact/send/route.ts`
- `src/app/api/head-coach/belt-promotions/[eventId]/export-pdf/route.ts`
- `src/app/api/kiosk-register/route.ts`
- `src/app/api/schedule/session-assignments/route.ts`
- `src/app/api/staff/list/route.ts`
- `src/app/api/store/orders/status/route.ts`
- `src/app/api/store/orders/update-status/route.ts`

## External configuration
- Vercel **Production** and custom **Staging** contain the new `SUPABASE_SECRET_KEY` as Sensitive variables.
- Legacy `SUPABASE_SERVICE_ROLE_KEY` is still configured in Vercel **Preview** and **Staging** as readable/encrypted secrets, generating `readable-secret` advisories.
- Vercel's current API response does not establish the status of any hidden Production legacy variable. Do not infer it is missing.
- Supabase Edge Functions listings for both projects returned no functions.
- GitHub Actions and local smoke scripts use local Supabase credentials; their dependencies must be distinguished from deployed server routes.
- External scripts, old clients, webhooks, third-party integrations, and any independently configured job credentials have **not** been conclusively inventoried.

## Migration gates
1. Migrate the baseline references in **small, role-aware PRs** to `createSupabaseAdminClient()` without changing business logic or bypassing authorization.
2. Verify CI, DB Reset + Smoke, Vercel Preview and Staging for each PR.
3. Exercise sensitive workflows (payroll, refunds, receipts, member invitations, freeze review, notifications, etc.) with isolated fixtures before Production.
4. Prepare scoped Production PRs and monitor runtime logs after release.
5. Reduce the allowlisted baseline; the audit test fails on *new* direct dependencies.
6. Only after all source, Vercel, CI, scripts and external consumers have been verified, prepare a separate, reversible key rotation procedure.

## Safety
Do not print or commit API keys. Never run migration tests with real users' payments. Do not click a generic Vercel Rotate Variable button or revoke Supabase JWT legacy keys while dependencies remain.
