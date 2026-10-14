-- Functional 1B.4.1: isolate function permissions in a separate migration.
-- One SQL statement per migration avoids prepared-statement multi-command errors.
revoke all on function public.manage_subscription_freeze_atomic(uuid,text,uuid,date,date,uuid) from public, anon, authenticated;
