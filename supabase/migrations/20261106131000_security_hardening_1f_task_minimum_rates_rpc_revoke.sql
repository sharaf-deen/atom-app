-- Security Hardening 1F: avoid client-side impersonation of payroll rate actor IDs.
-- SECURITY DEFINER RPC does not validate auth.uid or requester's role.
-- Preserve service_role EXECUTE. Validate the application's rate configuration
-- flow in Staging before merging (a direct browser RPC would need a guarded API).
REVOKE EXECUTE ON FUNCTION public.staff_payroll_save_task_minimum_rates(date, jsonb, jsonb, uuid)
FROM PUBLIC, anon, authenticated;
