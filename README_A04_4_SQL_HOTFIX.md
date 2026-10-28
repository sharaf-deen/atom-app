# A04.4 — SQL 42702 ambiguity hotfix (Staging first)

Problem: the PL/pgSQL function `atom_complete_registration_member_family_v1` declares `member_id` as an OUT parameter and referenced `WHERE member_id=a.id` without a table qualifier. This can cause PostgreSQL SQLSTATE 42702 `column reference "member_id" is ambiguous`.

Change: one source-level replacement, `FROM public.family_members fm WHERE fm.member_id=a.id`. No other business logic, grants or schema/data changes.

## Install

Apply the included migration through the existing Supabase STAGING migration deployment workflow, then inspect the migrated function with:

```sql
SELECT
  pg_get_functiondef(p.oid) LIKE '%WHERE fm.member_id=a.id%' AS qualified_member_id_present,
  pg_get_functiondef(p.oid) LIKE '%WHERE member_id=a.id%' AS old_unqualified_reference_present
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='atom_complete_registration_member_family_v1';
```

Expected true / false. Do not apply directly to Production before staging validation.

## Reconciliation before retry

```sql
SELECT id, status, member_user_id, family_id,
       auth_provisioning_recorded_at, last_error_code
FROM public.atom_public_registration_requests
WHERE id='05cf63e2-1edb-4f8a-bd7b-1b2c83c5bbc0';
```

Do not retry member-family on HTTP 503 before inspecting the deployed DB function and state. If a new failure occurs, capture sanitized PostgreSQL SQLSTATE from server-side diagnostics; don't print the claim ID.
