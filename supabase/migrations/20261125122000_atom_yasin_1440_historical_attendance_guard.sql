-- Follow-up to ATOM #1440: keep legitimate past attendance on the original 1m
-- subscription. The invalid future 3m subscription must have zero attendance.
-- Guarded replace: refuse to update if the installed reviewed function differs.
do $$
declare
 v_definition text;
 v_old text := 'or exists(select 1 from public.attendance where subscription_id in (c_old,c_wrong))';
 v_new text := 'or exists(select 1 from public.attendance where subscription_id=c_wrong)';
begin
 select pg_get_functiondef(oid) into v_definition
 from pg_proc where pronamespace='public'::regnamespace
   and proname='atom_correct_yasin_1440';
 if v_definition is null then raise exception 'FINANCIAL_RECOVERY_FUNCTION_MISSING';end if;
 if length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) then
   raise exception 'EXPECTED_OLD_ATTENDANCE_GUARD_NOT_UNIQUE';
 end if;
 if position('and not exists(' in v_definition)=0 or position('RECEIPT' in upper(v_definition))=0 then
   raise exception 'RECOVERY_FUNCTION_PROTECTION_CHECK_FAILED';
 end if;
 execute replace(v_definition,v_old,v_new);
 if not exists(select 1 from pg_proc
     where pronamespace='public'::regnamespace and proname='atom_correct_yasin_1440'
       and position(v_new in pg_get_functiondef(oid))>0) then
   raise exception 'NEW_ATTENDANCE_GUARD_NOT_INSTALLED';
 end if;
end $$;
