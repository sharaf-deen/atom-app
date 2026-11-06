-- Security Hardening 1F: privileged salary approval and rate RPCs are server-only.
-- Their corresponding API routes verify the authenticated Super Admin and use
-- a server-side privileged client. RPC parameters alone cannot authenticate an actor.
-- One SQL statement; do not revoke service_role EXECUTE.
REVOKE EXECUTE ON FUNCTION
  public.staff_payroll_approve_snapshot(uuid, uuid, text, text, text, text, text, text, text),
  public.staff_payroll_reopen_snapshot(uuid, uuid, text),
  public.staff_payroll_save_rate_period(uuid, uuid, date, numeric, numeric, boolean, jsonb, uuid)
FROM PUBLIC, anon, authenticated;
