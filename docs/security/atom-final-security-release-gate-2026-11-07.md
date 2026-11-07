# ATOM — Final Consolidated Security Release Gate (Staging, 2026-11-07)

## Objective and hard boundary

One consolidated migration and one report, with no production database or deployment changes. This gate is NOT a blanket green light for production.

## Confirmed findings and changes

- Previous verified finding: anonymous calls to `public.is_super_admin(uuid)` and `public.is_staff(uuid)` disclosed role membership of a known user UUID.
- Migration `20261107090032_security_final_release_gate_role_predicates_and_anon_revoke.sql` applied to Supabase Staging and versioned in this PR.
- Removed PUBLIC/anon EXECUTE from six RLS security-definer helper functions: guardian-of-family/member, is_ops, is_staff, is_super_admin and is_payment_validation_approver.
- Four role-predicate functions now return false when a regular signed-in user probes an unrelated UUID, preserving checks of their own role and explicitly trusted service_role internal actor lookups.
- Authenticated EXECUTE was retained for RLS policies; service_role retained for protected finance and payroll workflows. No tables, RLS policies or data rows modified.

## Results observed on Staging

- SQL privileges: 6/6 helper functions deny anon EXECUTE; authenticated and service_role retain EXECUTE.
- A simulated authenticated member cannot retrieve the superadmin or staff status of a different UUID, can read own profile and receives false for own ops status.
- Simulated authenticated superadmin sees their own superadmin/approver status and cannot retrieve another user's role.
- Simulated service_role can still determine legitimate superadmin, staff and approver statuses for arbitrary subject IDs.
- Security advisor `anon_security_definer_function_executable` 6 -> 0.
- Prior CI/DB Reset + Smoke/Vercel and 9/9 human functional validation relate to the **previous** Staging revision. New CI/DB Reset/Vercel and post-change functional regression must be verified separately.

## Pending / intentionally unchanged
- `authenticated_security_definer_function_executable`: 27 advisories, including authenticated RLS helpers and guarded application RPCs. An advisory is not itself proof of an exploitable vulnerability; targeted authorization audit is required.
- `rls_enabled_no_policy`: 30 INFO entries. No permissive RLS policies should be created merely to silence warnings.
- `auth_leaked_password_protection`: one WARN. Enable via Staging Supabase Auth settings if eligible (Supabase Pro and above), after considering password/authentication regression. Not a SQL migration.
- Real signed end-to-end HTTP sessions for member/guardian/coach/reception/admin/superadmin and controlled mutation tests of payments/refunds, payroll, subscriptions, inventory and QR require an isolated test harness and realistic fixtures. SQL JWT-context simulation is not a substitute.
- Protection against malicious server actor spoofing in functions accepting `p_actor` assumes these operations remain server-only; recheck ACLs and code paths before Production.

## Release decision

Automated SQL denial and intended backend service-role access: PASS. Full client end-to-end authorization and mutation certification: OPEN. **Production NO-GO** until evidence and explicit user authorization.
