# Security Hardening 1F — Consolidated Security Audit (Staging)

Status: **audit baseline; no permissions changed yet**. Production is out of scope until Staging checks and explicit approval.

## Objective
Consolidate the planned 1E.4–1E.6 audits: financial write protections, API role enforcement, RLS/RPC/SECURITY DEFINER, immutable financial history, audit trail, and final regression tests.

## Confirmed findings, 2026-11-06 (Supabase Staging read-only inspection)

### F1 — Financial authorization mismatch (HIGH; remediate after usage inventory)
- App RBAC `src/lib/rbac.ts` allows `canManageExpenses` and `canManagePayments` for `super_admin` only.
- `src/app/expenses/page.tsx` checks `canManageExpenses` server-side before writing with the privileged client.
- Database RLS `expenses_insert_ops`, `expenses_update_ops`, `payments_insert_ops`, `payments_update_ops` permits `is_ops(auth.uid())`; this includes `reception`, `admin`, and `super_admin`.
- Database RLS delete on these tables currently permits `is_admin_or_super_admin(auth.uid())`; this includes `admin`.
- A direct client request may therefore enjoy broader permission than the app's RBAC. **Do not tighten blindly** until all direct-client and front-desk workflows are inventoried. Retain legitimate subscription settlement capabilities.
- **Mitigation prepared, NOT yet applied:** six sequential `ALTER POLICY` migrations (`20261106122000` through `20261106122050`) align direct INSERT/UPDATE/DELETE on `expenses` and `payments` with `public.is_super_admin(auth.uid())`; SELECT policies are untouched. The server-side expenses form uses an explicit Super Admin check and privileged Supabase client; subscriptions settlement uses its own server-side flow. Validate all other payment-entry and front-desk paths on Staging before release. Read-only source test added.

### F2 — Exposed privileged functions (TRIAGE; risk not yet established per function)
- Supabase security advisor identified 95 callable `SECURITY DEFINER` functions for `anon` and 98 for `authenticated`; evaluate each function's internal authorization and intended access.
- Prioritize financial write, store sale, schedule modification and user-role operations. These advisor numbers are not exploit counts.
- **Priority investigation:** `public.admin_apply_store_sale_update(...)` is reported executable by `anon` and `authenticated`; its inspected PL/pgSQL definition contains mutation of sale payments/inventory without an explicit `auth.uid()` or role check. Confirm all application consumers and revoke inappropriate EXECUTE grants or introduce verified server-side authorization before calling 1F complete.
- **Mitigation staged:** `20261106121000_security_hardening_1f_store_privileged_rpc_revoke.sql` revokes `PUBLIC`, `anon`, and `authenticated` from two privileged Store sale mutations (`admin_apply_store_sale_update`, `admin_complete_store_preorder_as_sale`). Both have explicit `service_role` EXECUTE in Staging and the inspected Store update API uses an authenticated Super Admin guard plus a server admin client. Regression test added. Check other Store paths and role-specific behavior before Staging merge.
- Prefer REVOKE EXECUTE from PUBLIC/anon/authenticated for server-only RPCs; maintain explicit grants for deliberately public, self-service RPCs.

### F3 — Elevated view (TRIAGE)
- Supabase security advisor flagged `public.admin_income_events_open_v1` as SECURITY DEFINER.
- **Confirmed exposed:** Staging `has_table_privilege` was true for both `anon` and `authenticated` on this view, which includes member and payment metadata. The 1A REVOKE on `admin_income_events_v1` did not cover this separate view.
- **Fix prepared on this branch:** `20261106120000_security_hardening_1f_financial_view_revoke.sql` revokes client SELECT while preserving `service_role` access. Validate role-based client access and internal financial reporting on Staging after merge.

### F4 — Additional advisor notices (REVIEW)
- 30 mutable function search paths; one extension in public; leaked password protection setting; 30 RLS-enabled tables with no policies.
- No-policy RLS may intentionally be deny-all for service-only tables. Verify intent, don't add permissive policies simply to silence an advisory.

### F5 — Audit integrity baseline (VALIDATED STAGING)
- 1E.3 atomic subscription delete+audit RPC deployed to Staging, with service_role-only EXECUTE. Isolated rollback tests passed for success, failed audit, unauthorized actor, and protected financial history.
- Production deployment was separately verified in prior step. Do not unnecessarily change this RPC.

## Release gates
1. Inventory all client and server access to targeted financial tables/functions, including direct Supabase clients, server actions, RPCs, and mobile workflows.
2. For every proposed permission change, document explicit allowed roles, expected 401/403, non-regression path and rollback plan.
3. Submit minimum-privilege policy changes and regression tests in this **single consolidated Staging PR**, with logically isolated commits.
4. Require CI, DB Reset + Smoke, Vercel, and isolated role-matrix tests before Staging merge.
5. Repeat relevant end-to-end workflows on Staging; independently approve a targeted Production PR. Never merge `staging` wholesale into `main`.
6. Do not execute destructive financial tests against real member records.

## Links
- Supabase view advisory: https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view
- Supabase anon SECURITY DEFINER advisory: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- Supabase authenticated SECURITY DEFINER advisory: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

### F6 — Payroll payment SECURITY DEFINER RPCs (HIGH; mitigation staged)
- `staff_payroll_record_salary_payment` and `staff_payroll_reverse_salary_payment` were EXECUTABLE by `anon` and `authenticated` even though both accept caller-supplied actor identifiers and perform financial mutations. Their SQL definitions lacked session-bound authorization.
- Verified `src/app/api/staff-payroll/payments/route.ts` resolves the actual user with `auth.getUser()`, restricts operations to `super_admin`, and invokes the RPCs using the server admin client.
- Migration `20261106123000_security_hardening_1f_payroll_payment_rpc_revoke.sql` removes `PUBLIC`, `anon`, and `authenticated` EXECUTE while preserving the service-side path; source-only regression added. Validate Staging salary payment **read-only display** and denial; use isolated synthetic DB tests if needed, never real staff payments.

### F7 — Payroll approval and rate RPCs (HIGH; mitigation staged)
- `staff_payroll_approve_snapshot`, `staff_payroll_reopen_snapshot`, and `staff_payroll_save_rate_period` are SECURITY DEFINER RPCs available to both `anon` and `authenticated`. Actor UUID arguments do not prove the actual caller's identity; the approval/reopen functions were inspected without session-bound role checks.
- Verified `src/app/api/staff-payroll/approval/route.ts` and `src/app/api/staff-payroll/rates/route.ts` use authenticated Super Admin guards and a privileged server-side RPC client.
- Staged migration `20261106124000_security_hardening_1f_payroll_approval_rates_rpc_revoke.sql` revokes public and client-role EXECUTE for these three functions while retaining service_role. A source-only contract test verifies API guards. Validate Staging role-matrix and approval/rates display before release.

### F8 — Payroll closeout and monthly adjustment RPCs (HIGH; mitigation staged)
- Staging review confirmed `staff_payroll_close_payment_cycle`, `staff_payroll_reopen_payment_closeout`, `staff_payroll_create_monthly_adjustment`, and `staff_payroll_void_monthly_adjustment` allowed EXECUTE from `anon` and `authenticated`. Some rely on `p_actor_id` instead of authenticating the session; a forged actor ID is not proof of authority.
- Their application consumers `/api/staff-payroll/payment-closeout` and `/api/staff-payroll/adjustments` independently authenticate and enforce `super_admin`, then use the privileged admin RPC client.
- Migration `20261106125000_security_hardening_1f_payroll_closeout_adjustments_rpc_revoke.sql` blocks direct client RPC invocation, preserving service_role. A read-only source contract was added. Staging tests must cover closeout, adjustments and finance dashboards without recording real payments.

### F9 — Staff profile mutation RPC (HIGH; mitigation staged)
- `staff_payroll_save_staff_profile` is a privileged SECURITY DEFINER function, executable by public client roles, taking a client-provided `p_actor_id`. Its internal Super Admin check on that supplied identifier does not establish the requester's identity.
- Confirmed the application path `src/app/api/staff-payroll/staff-profiles/route.ts` validates the signed-in Super Admin and calls the function using its privileged server client.
- Prepared `20261106130000_security_hardening_1f_staff_profile_rpc_revoke.sql` and a read-only route permission contract. Validate display and guarded write paths on Staging before Production.
