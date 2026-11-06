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

### F2 — Exposed privileged functions (TRIAGE; risk not yet established per function)
- Supabase security advisor identified 95 callable `SECURITY DEFINER` functions for `anon` and 98 for `authenticated`; evaluate each function's internal authorization and intended access.
- Prioritize financial write, store sale, schedule modification and user-role operations. These advisor numbers are not exploit counts.
- **Priority investigation:** `public.admin_apply_store_sale_update(...)` is reported executable by `anon` and `authenticated`; its inspected PL/pgSQL definition contains mutation of sale payments/inventory without an explicit `auth.uid()` or role check. Confirm all application consumers and revoke inappropriate EXECUTE grants or introduce verified server-side authorization before calling 1F complete.
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
