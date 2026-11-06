-- Security Hardening 1F: payroll closeout and adjustments RPCs are server-only.
-- The corresponding /api/staff-payroll routes authenticate the actual actor,
-- require super_admin, and invoke these functions using the admin client.
-- No client may impersonate p_actor_id through privileged SECURITY DEFINER RPCs.
REVOKE EXECUTE ON FUNCTION
  public.staff_payroll_close_payment_cycle(uuid, uuid, text),
  public.staff_payroll_reopen_payment_closeout(uuid, uuid, text),
  public.staff_payroll_create_monthly_adjustment(date, uuid, text, numeric, text, uuid),
  public.staff_payroll_void_monthly_adjustment(uuid, text, uuid)
FROM PUBLIC, anon, authenticated;
