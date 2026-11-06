# Security Hardening 1F.1 — Financial table grants (Staging)

Applied to Supabase Staging on 2026-11-06 (project: atomjj-staging). Production NOT changed.

## Scope
Revoke SQL table privileges that bypass RLS or permit schema-related operations from Supabase client roles on `public.expenses` and `public.payments`. Preserve existing SELECT/INSERT/UPDATE/DELETE grants and all RLS policies until financial operation inventory and role regression tests.

## Applied SQL

```sql
REVOKE TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.expenses, public.payments
FROM anon, authenticated;
```

## Read-only verification (PASS — Staging)
Both tables: `has_table_privilege('anon', ..., 'TRUNCATE'/'TRIGGER'/'REFERENCES') = false` and the same checks for `authenticated = false`. `service_role` TRUNCATE remains true. `authenticated` SELECT and INSERT remain true. Verification did not exercise any data mutation or end-to-end workflows.

## Remaining gates
- Complete direct-client, server and RPC usage inventory for these tables.
- Validate reception/admin/super_admin matrix and ordinary subscription settlement; include API rejection tests and financial UI smoke tests.
- Do not change app RBAC or financial RLS policy until these paths are documented.
- CI, DB Reset+Smoke and Vercel Staging deployment tests prior to merge.
- No Production changes without separate approval.

## Rollback (only if investigation proves an essential dependency)
```sql
GRANT TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.expenses, public.payments
TO anon, authenticated;
```

Rollback restores pre-change SQL table privileges and should only run after explicit review because these privileges are unsafe for client roles.
