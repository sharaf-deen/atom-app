# ATOM Security Hardening — Final Consolidated Staging Audit (2026-11-06)

## Scope and guardrails
- Supabase Staging: `ovaxewmlwueixjxqczyg`; repository `sharaf-deen/atom-app`; base `staging`.
- **Production not modified.** All PRs 1F.1–1F.13 were previously merged into Staging.
- Security advisor findings are *heuristics*, not automatic proof of exploitability or successful security testing.
- This final lot deliberately avoids bulk revocation of RLS predicates and authenticated workflows.

## Applied in this final lot
- Supabase migration `20261106211855_security_hardening_final_pg_trgm_extension_schema` moved relocatable `pg_trgm` from `public` to `extensions`.
- Pinned the Store search implementation's `search_path` to include `extensions`; other examined legacy Store and Members search implementations already included it.
- SQL verified `pg_trgm` lives in `extensions`; `extensions.similarity()` resolves. Query calls to legacy Members and Store search under `service_role` succeeded (non-empty result counts).
- Supabase security advisor `extension_in_public`: 1 -> 0.

## Security advisor snapshot after the migration
| Advisor | Count | Disposition |
| --- | ---: | --- |
| extension_in_public | 0 | Resolved in this lot |
| function_search_path_mutable | 0 | Resolved in 1F.13 |
| security_definer_view | 0 | Resolved in 1F.11 |
| anon_security_definer_function_executable | 6 | RLS/guardian role predicates; retain until policy-by-policy replacement and role-based regression tests |
| authenticated_security_definer_function_executable | 27 | Includes RLS predicates and role-guarded application RPCs; retain authenticated access unless callers migrated and negative authorization tests performed |
| rls_enabled_no_policy | 30 INFO | Tables have RLS enabled with no policies; thus access is default-denied for non-bypass roles. Do **not** generate permissive policies simply to silence advisory; review grants, service-role design and business requirements per table |
| auth_leaked_password_protection | 1 | Auth dashboard setting; confirm feature availability, plan and possible operational effects before enabling |

## Follow-up gates before any Production rollout
1. Role-matrix negative tests for anon/member/guardian/coach/reception/admin/super_admin across scoped API and RLS paths, including family account and role predicates.
2. Registration and transactional mutation smoke (not just read-only page display); verify insert/update, attendance/check-in, Payroll, Store stock updates and financial validations with controlled fixtures/rollback.
3. Decide whether to migrate authenticated SECURITY DEFINER operations to server-only execution; ensure any helpers in RLS remain callable there.
4. Review each RLS-without-policy table and ensure direct grants are intentional; 15 of the 30 still had anon DML table privileges and 15 had authenticated DML table privileges when tested, though RLS denied row access in absence of policies.
5. Enable compromised-password protection in Supabase Auth settings if supported and permitted; retest login, registration, invitations and password reset.
6. Run CI, DB Reset + Smoke, Vercel and a full integrated Staging test after migration before merging this PR. Check merged Staging deployment separately.

This audit does **not** certify all residual risks as eliminated. Production remains an explicit NO-GO pending approval and final role-based functional security testing.
