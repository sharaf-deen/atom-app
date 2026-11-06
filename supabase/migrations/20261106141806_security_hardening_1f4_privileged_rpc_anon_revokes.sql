-- Security Hardening 1F.4: narrow anon EXECUTE grants on five privileged RPCs.
REVOKE EXECUTE ON FUNCTION public.admin_apply_store_sale_update(uuid,text,integer,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_complete_store_preorder_as_sale(uuid,text,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.private_coaching_confirm_payment(uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.staff_payroll_approve_snapshot(uuid,uuid,text,text,text,text,text,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.staff_payroll_record_salary_payment(uuid,uuid,numeric,text,date,text,text) FROM PUBLIC, anon;
