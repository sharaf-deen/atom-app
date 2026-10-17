-- Functional 1C.4D: Trigger Permission Hardening
-- Restrict direct EXECUTE access to internal prospect trigger functions.
-- Existing trigger bindings remain enabled.
-- Idempotent; safe when permissions are already revoked.

REVOKE EXECUTE ON FUNCTION
  public.prospect_sync_from_visitor_member(),
  public.prospects_audit_change(),
  public.prospects_before_write()
FROM PUBLIC, anon, authenticated;