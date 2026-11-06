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

## 1F.2 authorization mismatch confirmed (read-only investigation)
- `src/lib/rbac.ts`: `FINANCE_ROLES = ['super_admin']`, `FINANCE_READ_ROLES = ['admin','super_admin']`; thus `canManageExpenses` and `canManagePayments` are super-admin-only.
- `src/app/expenses/page.tsx`: server action checks `canManageExpenses(me.role)` prior to financial write.
- `src/app/api/subscriptions/settle/route.ts`: includes `canCreateSubscription` and `canManagePayments` distinctions; do not assume every payment-related action should be super-admin-only.
- Staging policies on both financial tables use `is_ops(auth.uid())` for INSERT and UPDATE; DELETE uses `is_admin_or_super_admin(auth.uid())`.
- Staging function `is_ops(uuid)` explicitly allows `reception`, `admin`, `super_admin`; `is_admin_or_super_admin(uuid)` allows `admin`, `super_admin`.
- Confirmed SQL grant restrictions above do NOT close this RBAC/RLS mismatch.

## 1F.2 next safe change gates
1. Inventory application and RPC direct financial writes, especially reception subscription settlements and payment correction paths.
2. Separate manually managed expenses/payments (super-admin-only) from transaction-ledger mutations needed by authorized subscription settlement.
3. Add least-privilege migration and isolated actor-matrix tests in a further commit only after inventory; never blindly revoke all authenticated INSERT/UPDATE/DELETE.
4. Verify unauthorized access denial and authorized reception flows in Staging; only then assess Production.

Current status: **triage verified; role-policy remediation not yet applied**.

## 1F.2 — Expenses write RLS (Staging applied 2026-11-06)

```sql
BEGIN;
ALTER POLICY expenses_insert_ops ON public.expenses WITH CHECK (public.is_super_admin(auth.uid()));
ALTER POLICY expenses_update_ops ON public.expenses USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));
ALTER POLICY expenses_delete_admin ON public.expenses USING (public.is_super_admin(auth.uid()));
COMMIT;
```

Read-only verification PASS: all three expenses write policies now require `is_super_admin(auth.uid())`. The expenses SELECT policy and all payments policies were retained. The subscription settlement route uses `subscription_payments`, not a direct write to the `payments` table in its inspected path.

**Pending:** real role-matrix and UI tests. This was applied directly to Staging, not via migration history. Reconcile as a versioned migration using the Supabase CLI before deploy. Production unchanged.

Rollback if regression requires it, after review:

```sql
BEGIN;
ALTER POLICY expenses_insert_ops ON public.expenses WITH CHECK (public.is_ops(auth.uid()));
ALTER POLICY expenses_update_ops ON public.expenses USING (public.is_ops(auth.uid())) WITH CHECK (public.is_ops(auth.uid()));
ALTER POLICY expenses_delete_admin ON public.expenses USING (public.is_admin_or_super_admin(auth.uid()));
COMMIT;
```
