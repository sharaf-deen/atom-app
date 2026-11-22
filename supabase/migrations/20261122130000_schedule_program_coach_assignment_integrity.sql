-- ATOM Schedule / Operations — Program Coach Assignment Integrity
-- A recurring schedule_default is only a fallback; a published program owns its
-- future assigned sessions unless a manager explicitly overrides that session.
-- Never alter completed, past, in-progress, attended, logged or payroll-linked sessions.
begin;

create or replace function public.sync_training_program_team_to_future_sessions_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := coalesce(new.updated_by, auth.uid());
  v_session record;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_current_time time := (now() at time zone 'Africa/Cairo')::time;
begin
  if new.responsible_coach_user_id is not distinct from old.responsible_coach_user_id
     and new.assistant_coach_1_user_id is not distinct from old.assistant_coach_1_user_id
     and new.assistant_coach_2_user_id is not distinct from old.assistant_coach_2_user_id then
    return new;
  end if;

  if new.status <> 'published' or new.responsible_coach_user_id is null then
    return new;
  end if;

  for v_session in
    select s.id
    from public.schedule_session_training_program_assignments spa
    join public.schedule_training_sessions s on s.id = spa.training_session_id
    where spa.program_id = new.id and spa.is_active
      and s.status = 'scheduled'
      and (
        s.session_date > v_today
        or (s.session_date = v_today and s.start_time > v_current_time)
      )
      and not exists (
        select 1 from public.coach_training_session_logs l
        where l.training_session_id = s.id
      )
      and not exists (
        select 1 from public.coach_staff_attendance a
        where a.training_session_id = s.id
      )
      and not exists (
        select 1 from public.staff_payroll_coaching_import_items i
        where i.training_session_id = s.id and i.status = 'active'
      )
      and not exists (
        select 1 from public.schedule_session_coach_assignments a
        where a.training_session_id = s.id
          and a.is_active
          and (
            a.assignment_source in ('manual','session_override')
            or (a.assignment_source = 'program' and a.source_program_id is distinct from new.id)
          )
      )
    order by s.session_date, s.start_time, s.id
  loop
    -- Inherits program coach/assistants, superseding schedule_default fallback.
    perform public.apply_training_program_team_to_session(v_session.id, new.id, v_actor);
  end loop;

  return new;
end;
$$;

-- Existing trigger remains in place: replacing its function updates behaviour.
-- Repair only currently stale, pre-existing, future (not started) scheduled sessions.
-- This does not generate sessions, alter historical assignments, or touch payroll.
do $$
declare
  v_session record;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_current_time time := (now() at time zone 'Africa/Cairo')::time;
  v_fixed integer := 0;
begin
  for v_session in
    select s.id as session_id, pr.id as program_id, pr.updated_by as actor_id
    from public.schedule_session_training_program_assignments spa
    join public.schedule_training_sessions s on s.id = spa.training_session_id
    join public.coach_training_programs pr on pr.id = spa.program_id
    where spa.is_active and pr.status = 'published'
      and s.status = 'scheduled'
      and (
        s.session_date > v_today
        or (s.session_date = v_today and s.start_time > v_current_time)
      )
      and s.session_date between pr.start_date and pr.end_date
      and exists (
        select 1 from public.coach_training_program_class_templates map
        where map.program_id = pr.id
          and map.class_template_id = s.class_template_id and map.is_active
      )
      and exists (
        select 1 from public.schedule_session_coach_assignments a
        where a.training_session_id=s.id and a.is_active
          and a.assignment_role='primary_coach'
          and a.staff_user_id is distinct from pr.responsible_coach_user_id
          and a.assignment_source in ('program','schedule_default')
      )
      and not exists (
        select 1 from public.schedule_session_coach_assignments a
        where a.training_session_id=s.id and a.is_active
          and (a.assignment_source in ('manual','session_override')
               or (a.assignment_source='program' and a.source_program_id is distinct from pr.id))
      )
      and not exists (
        select 1 from public.coach_training_session_logs l
        where l.training_session_id=s.id
      )
      and not exists (
        select 1 from public.coach_staff_attendance a
        where a.training_session_id=s.id
      )
      and not exists (
        select 1 from public.staff_payroll_coaching_import_items i
        where i.training_session_id=s.id and i.status='active'
      )
    order by s.session_date, s.start_time,s.id
    for update of s
  loop
    perform public.apply_training_program_team_to_session(
      v_session.session_id,v_session.program_id,v_session.actor_id
    );
    v_fixed := v_fixed+1;
  end loop;
  raise notice 'Program coach assignment repair: % eligible future sessions resynchronized', v_fixed;
end $$;

commit;
