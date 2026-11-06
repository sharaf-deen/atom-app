-- Security Hardening 1F.5: Payroll mutation RPCs invoked through authenticated Super Admin-guarded Next.js server routes.
-- Applied to Supabase Staging, migration 20261106144901. Retain service_role; remove direct client access.
REVOKE EXECUTE ON FUNCTION public.staff_payroll_close_payment_cycle(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_payroll_create_monthly_adjustment(date,uuid,text,numeric,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_payroll_reopen_payment_closeout(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_payroll_reopen_snapshot(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_payroll_reverse_salary_payment(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_payroll_save_rate_period(uuid,uuid,date,numeric,numeric,boolean,jsonb,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_payroll_save_staff_profile(uuid,uuid,text,text[],text,date,date,text,uuid[],uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_payroll_void_monthly_adjustment(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
