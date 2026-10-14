-- Functional 1B.4.1: service role is the only API execution role.
grant execute on function public.manage_subscription_freeze_atomic(uuid,text,uuid,date,date,uuid) to service_role;
