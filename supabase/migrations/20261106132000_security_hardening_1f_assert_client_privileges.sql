-- One-statement deployment guard. Fail if restricted client privileges survive.
DO $$
BEGIN
  IF has_table_privilege('anon','public.admin_income_events_open_v1','SELECT')
     OR has_table_privilege('authenticated','public.admin_income_events_open_v1','SELECT') THEN
    RAISE EXCEPTION 'SECURITY_1F_FINANCIAL_VIEW_STILL_EXPOSED';
  END IF;
  IF has_function_privilege('anon','public.staff_payroll_save_task_minimum_rates(date,jsonb,jsonb,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.staff_payroll_save_task_minimum_rates(date,jsonb,jsonb,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'SECURITY_1F_PAYROLL_RATE_RPC_STILL_EXPOSED';
  END IF;
  IF NOT has_function_privilege('service_role','public.staff_payroll_save_task_minimum_rates(date,jsonb,jsonb,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'SECURITY_1F_SERVER_RATE_RPC_PRIVILEGE_MISSING';
  END IF;
END;
$$;
