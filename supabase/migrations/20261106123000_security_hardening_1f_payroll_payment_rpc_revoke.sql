-- Security Hardening 1F: salary payment and reversal RPCs are server-only.
-- The API /api/staff-payroll/payments verifies the authenticated Super Admin
-- and calls these SECURITY DEFINER functions using the privileged server client.
-- The functions themselves accept p_actor_id from the caller, so client EXECUTE
-- is unsafe. Preserve service_role EXECUTE. One SQL statement per migration.
REVOKE EXECUTE ON FUNCTION
  public.staff_payroll_record_salary_payment(uuid, uuid, numeric, text, date, text, text),
  public.staff_payroll_reverse_salary_payment(uuid, uuid, text)
FROM PUBLIC, anon, authenticated;
