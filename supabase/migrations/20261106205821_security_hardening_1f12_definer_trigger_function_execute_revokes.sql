-- Security Hardening 1F.12 — Staging 20261106205821.
-- Existing triggers are left intact; direct caller EXECUTE removed from definer trigger functions.
-- service_role and function owners remain capable of intended privileged operations.
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prosecdef
      AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.signature);
  END LOOP;
END $$;
