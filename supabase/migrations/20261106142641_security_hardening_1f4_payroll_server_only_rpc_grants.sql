-- Security Hardening 1F.4: payroll RPCs are used through Super Admin-guarded server API routes.
-- Applied to Supabase Staging migration 20261106142641.
REVOKE EXECUTE ON FUNCTION public.staff_payroll_approve_snapshot(uuid,uuid,text,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_payroll_record_salary_payment(uuid,uuid,numeric,text,date,text,text) FROM PUBLIC, anon, authenticated;
