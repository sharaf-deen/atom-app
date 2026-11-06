-- Security Hardening 1F.9 — Staging 20261106201914.
-- Restrict anonymous direct invocation; keep authenticated role checks and service_role access.
REVOKE EXECUTE ON FUNCTION public.apply_schedule_session_exception(uuid,text,text,time without time zone,time without time zone,text,uuid,uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.coach_delete_curriculum_item_if_unused(text,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.coach_delete_training_program_if_unused(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.coach_training_program_delete_impact(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_coach_training_program_schedule_templates(uuid,uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_schedule_series_coaching_team(text,uuid,uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_schedule_session_coach_assignments(uuid,uuid,uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_schedule_session_training_program(uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.staff_payroll_import_coaching_sessions(date,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.staff_payroll_reconcile_qr_attendance(uuid,uuid,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.store_apply_supplier_received_qty(uuid,integer) FROM PUBLIC, anon;
