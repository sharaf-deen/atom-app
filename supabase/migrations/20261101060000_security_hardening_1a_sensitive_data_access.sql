-- Security Hardening 1A — protect sensitive views and private coaching promo codes.
-- Scope: privilege reduction only. Existing application service_role access is preserved.
-- No data mutation, view rebuild, column changes, or new direct-client access.
--
-- Before production release:
--   (1) Merge to staging and let Supabase DB Deploy (staging) apply this migration.
--   (2) Verify DB Smoke and the post-migration permission assertions.
--   (3) Verify staff-facing attendance, member search, scan audit, financial review
--       and private coaching promo management workflows on staging.
--   (4) Merge to main only after those checks pass.

BEGIN;

-- Private coaching promo codes are managed and validated by server routes that
-- authenticate users and then use the privileged server-side Supabase client.
-- The underlying table must never be readable or mutable directly by clients.
ALTER TABLE public.private_coaching_promo_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.private_coaching_promo_codes FROM anon, authenticated;

-- Views/materialized view currently bypass their underlying RLS and expose
-- member contact/identity data, attendance, scans, or financial information.
-- Deny direct PostgREST access to both anonymous and ordinary authenticated users.
-- Server operations using service_role retain their existing permissions.
REVOKE ALL PRIVILEGES ON TABLE
  public.members_with_activity,
  public.members_with_activity_mv,
  public.attendance_with_day,
  public.scan_audit,
  public.admin_income_events_v1,
  public.payment_validation_open_groups_v1
FROM anon, authenticated;

-- Fail the migration if an exposed role still has direct access to a target.
DO $security_hardening_1a$
DECLARE
  target text;
  role_name text;
BEGIN
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relname='private_coaching_promo_codes')
  THEN
    RAISE EXCEPTION '1A: private_coaching_promo_codes RLS not enabled';
  END IF;

  FOREACH target IN ARRAY ARRAY[
    'private_coaching_promo_codes', 'members_with_activity', 'members_with_activity_mv',
    'attendance_with_day', 'scan_audit', 'admin_income_events_v1',
    'payment_validation_open_groups_v1'
  ] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF pg_catalog.has_table_privilege(role_name, 'public.' || target, 'SELECT')
         OR pg_catalog.has_table_privilege(role_name, 'public.' || target, 'INSERT')
         OR pg_catalog.has_table_privilege(role_name, 'public.' || target, 'UPDATE')
         OR pg_catalog.has_table_privilege(role_name, 'public.' || target, 'DELETE')
      THEN
        RAISE EXCEPTION '1A: direct access persists: %.%', role_name, target;
      END IF;
    END LOOP;
    IF NOT pg_catalog.has_table_privilege('service_role', 'public.' || target, 'SELECT')
    THEN
      RAISE EXCEPTION '1A: service role lost read access to %', target;
    END IF;
  END LOOP;
END
$security_hardening_1a$;

COMMIT;
