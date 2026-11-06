REVOKE EXECUTE ON FUNCTION public.private_coaching_decline_session_request(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.private_coaching_propose_session_time(uuid,uuid,date,time without time zone,time without time zone,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.private_coaching_quick_book(uuid,uuid,date,time without time zone,time without time zone,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.private_coaching_record_backdated_completed(uuid,uuid,date,time without time zone,time without time zone,text,text,boolean,boolean,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_payroll_save_task_minimum_rates(date,jsonb,jsonb,uuid) FROM PUBLIC, anon, authenticated;
