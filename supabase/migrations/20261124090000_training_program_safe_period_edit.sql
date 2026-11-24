-- ATOM Training Programs — safe period-only edit.
-- Preview is read-only. Apply runs under one DB transaction and never rewrites curriculum.
create or replace function public.coach_training_program_period_change(
 p_program_id uuid,
 p_new_start date,
 p_new_end date,
 p_mode text default 'preview',
 p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql security definer
set search_path = public, auth
as $$
declare
 v_actor uuid := auth.uid();
 v_role text;
 v_program public.coach_training_programs%rowtype;
 v_today date := (now() at time zone 'Africa/Cairo')::date;
 v_preview jsonb;
 v_conflicts integer := 0;
 v_add integer := 0;
 v_remove integer := 0;
 v_protected integer := 0;
 v_protected_add integer := 0;
 v_preserved integer := 0;
 v_result jsonb;
begin
 select role::text into v_role from public.profiles where user_id=v_actor;
 if v_actor is null or v_role not in ('head_coach','super_admin') then
   raise exception 'FORBIDDEN' using errcode='42501';
 end if;
 if p_mode not in ('preview','apply') then raise exception 'INVALID_OPERATION'; end if;
 if p_new_start is null or p_new_end is null or p_new_end<p_new_start
    or p_new_end-p_new_start>365 then raise exception 'INVALID_PERIOD'; end if;
 if p_mode='apply' then
   select * into v_program from public.coach_training_programs
     where id=p_program_id for update;
 else
   select * into v_program from public.coach_training_programs
     where id=p_program_id;
 end if;
 if not found then raise exception 'PROGRAM_NOT_FOUND'; end if;
 if v_program.status<>'published' then raise exception 'PUBLISHED_PROGRAM_REQUIRED'; end if;
 if p_mode='apply' and (p_expected_updated_at is null or v_program.updated_at is distinct from p_expected_updated_at) then
   raise exception 'PROGRAM_CHANGED_REFRESH_PREVIEW'; end if;
 if not exists(select 1 from public.coach_training_program_class_templates m
   where m.program_id=p_program_id and m.is_active) then
   raise exception 'PROGRAM_SCHEDULE_REQUIRED'; end if;
 select count(distinct pr.id) into v_conflicts
 from public.coach_training_program_class_templates mine
 join public.coach_training_program_class_templates other
   on other.class_template_id=mine.class_template_id and other.is_active
     and other.program_id<>mine.program_id
 join public.coach_training_programs pr
   on pr.id=other.program_id and pr.status='published'
 where mine.program_id=p_program_id and mine.is_active
   and pr.start_date<=p_new_end and pr.end_date>=p_new_start;

 -- Proposed new eligible dated sessions not already linked to this program.
 select count(*) into v_add
 from public.schedule_training_sessions s
 join public.coach_training_program_class_templates m on m.class_template_id=s.class_template_id
   and m.program_id=p_program_id and m.is_active
 where s.status='scheduled' and s.session_date between greatest(v_today,p_new_start) and p_new_end
   and not exists(select 1 from public.coach_training_session_logs l where l.training_session_id=s.id)
   and not exists(select 1 from public.schedule_session_training_program_assignments spa
     where spa.training_session_id=s.id and spa.is_active)
   and not exists(select 1 from public.staff_payroll_coaching_import_items pi
     where pi.training_session_id=s.id)
   and not exists(select 1 from public.staff_payroll_coaching_confirmations pc
     where pc.training_session_id=s.id)
   and not exists(select 1 from public.coach_staff_attendance ca
     where ca.training_session_id=s.id);

 -- Evidence-bearing new sessions may not be pulled into an edited program.
 select count(*) into v_protected_add
 from public.schedule_training_sessions s
 join public.coach_training_program_class_templates m on m.class_template_id=s.class_template_id
   and m.program_id=p_program_id and m.is_active
 where s.status='scheduled' and s.session_date between greatest(v_today,p_new_start) and p_new_end
   and not exists(select 1 from public.schedule_session_training_program_assignments spa
     where spa.training_session_id=s.id and spa.is_active)
   and (
     exists(select 1 from public.coach_staff_attendance ca where ca.training_session_id=s.id)
     or exists(select 1 from public.coach_training_session_logs l where l.training_session_id=s.id)
     or exists(select 1 from public.staff_payroll_coaching_import_items pi where pi.training_session_id=s.id)
     or exists(select 1 from public.staff_payroll_coaching_confirmations pc where pc.training_session_id=s.id)
   );

 -- Out-of-period future links that can safely be detached.
 select
   count(*) filter(where not (
      exists(select 1 from public.coach_staff_attendance a where a.training_session_id=s.id)
      or exists(select 1 from public.coach_training_session_logs l where l.training_session_id=s.id)
      or exists(select 1 from public.staff_payroll_coaching_import_items pi where pi.training_session_id=s.id)
      or exists(select 1 from public.staff_payroll_coaching_confirmations pc where pc.training_session_id=s.id)
      or exists(select 1 from public.schedule_session_coach_assignments ca
        where ca.training_session_id=s.id and ca.is_active and ca.assignment_source in ('manual','session_override'))
   )),
   count(*) filter(where
      exists(select 1 from public.coach_staff_attendance a where a.training_session_id=s.id)
      or exists(select 1 from public.coach_training_session_logs l where l.training_session_id=s.id)
      or exists(select 1 from public.staff_payroll_coaching_import_items pi where pi.training_session_id=s.id)
      or exists(select 1 from public.staff_payroll_coaching_confirmations pc where pc.training_session_id=s.id)
      or exists(select 1 from public.schedule_session_coach_assignments ca
        where ca.training_session_id=s.id and ca.is_active and ca.assignment_source in ('manual','session_override'))
   )
 into v_remove,v_protected
 from public.schedule_session_training_program_assignments spa
 join public.schedule_training_sessions s on s.id=spa.training_session_id
 where spa.program_id=p_program_id and spa.is_active and s.status='scheduled'
   and s.session_date>=v_today
   and (s.session_date<p_new_start or s.session_date>p_new_end);

 select count(*) into v_preserved from public.schedule_session_training_program_assignments spa
 join public.schedule_training_sessions s on s.id=spa.training_session_id
 where spa.program_id=p_program_id and spa.is_active and s.session_date<v_today
   and (s.session_date<p_new_start or s.session_date>p_new_end);

 v_preview:=jsonb_build_object(
   'programId',p_program_id,
   'status',v_program.status,
   'oldStartDate',v_program.start_date,
   'oldEndDate',v_program.end_date,
   'newStartDate',p_new_start,
   'newEndDate',p_new_end,
   'updatedAt',v_program.updated_at,
   'toLink',v_add,'toUnlink',v_remove,
   'protectedFutureLinks',v_protected,
   'protectedNewSessions',v_protected_add,
   'historicalLinksPreserved',v_preserved,
   'conflictingPrograms',v_conflicts,
   'curriculumUnchanged',true,'coachAssignmentOverridesPreserved',true,
   'canApply',(v_conflicts=0 and v_protected=0 and v_protected_add=0),
   'unchanged',(v_program.start_date=p_new_start and v_program.end_date=p_new_end)
 );
 if p_mode='preview' then return jsonb_build_object('ok',true,'preview',v_preview); end if;
 if v_conflicts>0 then raise exception 'PROGRAM_TEMPLATE_PERIOD_CONFLICT'; end if;
 if v_protected>0 or v_protected_add>0 then raise exception 'PROGRAM_PERIOD_HAS_PROTECTED_FUTURE_LINKS'; end if;
 if v_program.start_date=p_new_start and v_program.end_date=p_new_end then
    return jsonb_build_object('ok',true,'changed',false,'preview',v_preview);
 end if;
 update public.coach_training_programs set
   start_date=p_new_start,end_date=p_new_end,updated_by=v_actor,updated_at=now()
 where id=p_program_id;
 -- Existing system routine handles scheduled links and program-owned coach defaults.
 -- Never edit curriculum items, coach identities, or class-template mappings.
 v_result:=public.sync_training_program_schedule_internal(p_program_id,v_actor);
 if coalesce((v_result->>'conflicts')::integer,0)>0 then
   raise exception 'PROGRAM_PERIOD_SYNC_CONFLICT';
 end if;
 return jsonb_build_object('ok',true,'changed',true,'preview',v_preview,'sync',v_result);
end;
$$;
revoke all on function public.coach_training_program_period_change(uuid,date,date,text,timestamptz) from public;
grant execute on function public.coach_training_program_period_change(uuid,date,date,text,timestamptz) to authenticated;