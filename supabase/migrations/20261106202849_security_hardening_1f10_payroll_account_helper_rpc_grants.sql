-- Security Hardening 1F.10: prevent direct public RPC access to privileged Payroll account-link helpers.
-- Applied to Supabase Staging as migration 20261106202849.
-- SECURITY DEFINER callers and trusted server role retain their intended access.
REVOKE EXECUTE ON FUNCTION public.staff_payroll_canonical_user_id(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_payroll_is_secondary_account(uuid) FROM PUBLIC, anon, authenticated;
