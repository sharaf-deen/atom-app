-- Security Hardening 1F: Staff Payroll profile configuration is server-only.
-- The /api/staff-payroll/staff-profiles endpoint authenticates Super Admin
-- and uses a privileged server RPC client. Actor UUID arguments are not authentication.
REVOKE EXECUTE ON FUNCTION
  public.staff_payroll_save_staff_profile(uuid, uuid, text, text[], text, date, date, text, uuid[], uuid[])
FROM PUBLIC, anon, authenticated;
