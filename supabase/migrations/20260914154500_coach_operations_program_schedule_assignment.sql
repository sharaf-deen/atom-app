-- Coach Operations — Program Schedule Assignment & My Programs
-- Links Training Programs to recurring Class Templates so existing and future dated sessions
-- inherit the published program and its Responsible Coach / Assistant team automatically.
-- Historical sessions and sessions with Training Logs remain protected.

begin;

create table if not exists public.coach_training_program_class_templates (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.coach_training_programs(id) on delete cascade,
  class_template_id uuid not null references public.schedule_class_templates(id) on delete restrict,

  class_name_snapshot text not null,
  series_key_snapshot text not null,
  day_of_week_snapshot smallint not null,
  start_time_snapshot time without time zone not null,
  mat_snapshot text null,

  is_active boolean not null default true,
  assigned_by uuid null references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  removed_by uuid null references auth.users(id) on delete set null,
  removed_at timestamptz null,
  updated_at timestamptz not null default now(),

  constraint coach_training_program_class_templates_name_length
    check (char_length(btrim(class_name_snapshot)) between 2 and 180),
  constraint coach_training_program_class_templates_series_length
    check (char_length(btrim(series_key_snapshot)) between 1 and 180),
  constraint coach_training_program_class_templates_day_check
    check (day_of_week_snapshot between 0 and 6),
  constraint coach_training_program_class_templates_mat_length
    check (mat_snapshot is null or char_length(btrim(mat_snapshot)) between 1 and 80),
  constraint coach_training_program_class_templates_removed_state_check
    check (
      (is_active and removed_at is null)
      or
      ((not is_active) and removed_at is not null)
    )
);

create unique index if not exists coach_training_program_class_templates_active_uq
  on public.coach_training_program_class_templates (program_id, class_template_id)
  where is_active;

create index if not exists coach_training_program_class_templates_program_idx
  on public.coach_training_program_class_templates (program_id, is_active, class_template_id);

create index if not exists coach_training_program_class_templates_template_idx
  on public.coach_training_program_class_templates (class_template_id, is_active, program_id);

alter table public.coach_training_program_class_templates enable row level security;

grant select on public.coach_training_program_class_templates to authenticated;
revoke insert, update, delete on public.coach_training_program_class_templates from authenticated;

drop policy if exists coach_training_program_class_templates_read_coaching_team
  on public.coach_training_program_class_templates;
create policy coach_training_program_class_templates_read_coaching_team
on public.coach_training_program_class_templates
for select to authenticated
using (
  exists (
    select 1
    from public.profiles p
    join public.coach_training_programs pr
      on pr.id = coach_training_program_class_templates.program_id
    where p.user_id = auth.uid()
      and (
        p.role::text = any (array['head_coach','super_admin']::text[])
        or (
          p.role::text = any (array['assistant_coach','coach']::text[])
          and pr.status = 'published'
          and auth.uid() = any (
            array[
              pr.responsible_coach_user_id,
              pr.assistant_coach_1_user_id,
              pr.assistant_coach_2_user_id
            ]::uuid[]
          )
        )
      )
  )
);

-- Internal helper: unlink only a future scheduled session with no Training Log.
-- Program-sourced coach assignments are removed with the program link; manual manager
-- assignments are intentionally preserved.
create or replace function public.unlink_training_program_from_session_internal(
  p_session_id uuid,
  p_program_id uuid,
  p_actor uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_assignment_id uuid;
begin
  if exists (
    select 1
    from public.coach_training_session_logs l
    where l.training_session_id = p_session_id
  ) then
    return false;
  end if;

  select a.id
    into v_assignment_id
  from public.schedule_session_training_program_assignments a
  join public.schedule_training_sessions s on s.id = a.training_session_id
  where a.training_session_id = p_session_id
    and a.program_id = p_program_id
    and a.is_active
    and s.status = 'scheduled'
    and s.session_date >= ((now() at time zone 'Africa/Cairo')::date)
  limit 1;

  if v_assignment_id is null then
    return false;
  end if;

  update public.schedule_session_training_program_assignments
  set
    is_active = false,
    removed_by = v_actor,
    removed_at = now(),
    updated_at = now()
  where id = v_assignment_id;

  update public.schedule_session_coach_assignments a
  set
    is_active = false,
    removed_by = v_actor,
    removed_at = now(),
    updated_at = now()
  where a.training_session_id = p_session_id
    and a.is_active
    and a.source_program_id = p_program_id
    and a.assignment_source in ('program','session_override');

  return true;
end;
$$;

revoke all on function public.unlink_training_program_from_session_internal(uuid, uuid, uuid) from public;
revoke all on function public.unlink_training_program_from_session_internal(uuid, uuid, uuid) from authenticated;

-- Internal helper used by program sync and the future-session insert trigger.
-- It never overwrites an already-linked different program. Existing manual/session-override
-- coach assignments are preserved as a deliberate session-level exception.
create or replace function public.apply_mapped_training_program_to_session_internal(
  p_session_id uuid,
  p_program_id uuid,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_session_date date;
  v_session_status text;
  v_template_id uuid;
  v_program_title text;
  v_program_group text;
  v_program_start date;
  v_program_end date;
  v_program_status text;
  v_responsible uuid;
  v_current_assignment_id uuid;
  v_current_program_id uuid;
  v_has_non_program_staff boolean := false;
  v_team_inherited boolean := false;
begin
  select s.session_date, s.status, s.class_template_id
    into v_session_date, v_session_status, v_template_id
  from public.schedule_training_sessions s
  where s.id = p_session_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'SESSION_NOT_FOUND');
  end if;

  if v_session_status <> 'scheduled' then
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'SESSION_NOT_SCHEDULED');
  end if;

  select
    pr.title,
    pr.target_group,
    pr.start_date,
    pr.end_date,
    pr.status,
    pr.responsible_coach_user_id
    into
      v_program_title,
      v_program_group,
      v_program_start,
      v_program_end,
      v_program_status,
      v_responsible
  from public.coach_training_programs pr
  where pr.id = p_program_id;

  if not found or v_program_status <> 'published' then
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'PROGRAM_NOT_PUBLISHED');
  end if;

  if v_responsible is null then
    raise exception 'PROGRAM_RESPONSIBLE_COACH_REQUIRED';
  end if;

  if v_session_date < v_program_start or v_session_date > v_program_end then
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'SESSION_OUTSIDE_PROGRAM_PERIOD');
  end if;

  if not exists (
    select 1
    from public.coach_training_program_class_templates m
    where m.program_id = p_program_id
      and m.class_template_id = v_template_id
      and m.is_active
  ) then
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'TEMPLATE_NOT_MAPPED');
  end if;

  if exists (
    select 1
    from public.coach_training_session_logs l
    where l.training_session_id = p_session_id
  ) then
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'SESSION_HAS_TRAINING_LOG');
  end if;

  select a.id, a.program_id
    into v_current_assignment_id, v_current_program_id
  from public.schedule_session_training_program_assignments a
  where a.training_session_id = p_session_id
    and a.is_active
  limit 1;

  if v_current_assignment_id is not null and v_current_program_id <> p_program_id then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'conflict', true,
      'reason', 'SESSION_ALREADY_HAS_OTHER_PROGRAM',
      'program_id', v_current_program_id
    );
  end if;

  if v_current_assignment_id is not null and v_current_program_id = p_program_id then
    update public.schedule_session_training_program_assignments
    set
      program_title_snapshot = v_program_title,
      target_group_snapshot = v_program_group,
      program_start_date_snapshot = v_program_start,
      program_end_date_snapshot = v_program_end,
      updated_at = now()
    where id = v_current_assignment_id;

    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'program_id', p_program_id,
      'reason', 'ALREADY_LINKED'
    );
  end if;

  insert into public.schedule_session_training_program_assignments (
    training_session_id,
    program_id,
    program_title_snapshot,
    target_group_snapshot,
    program_start_date_snapshot,
    program_end_date_snapshot,
    assigned_by
  ) values (
    p_session_id,
    p_program_id,
    v_program_title,
    v_program_group,
    v_program_start,
    v_program_end,
    v_actor
  );

  select exists (
    select 1
    from public.schedule_session_coach_assignments a
    where a.training_session_id = p_session_id
      and a.is_active
      and a.assignment_source <> 'program'
  ) into v_has_non_program_staff;

  if not v_has_non_program_staff then
    perform public.apply_training_program_team_to_session(p_session_id, p_program_id, v_actor);
    v_team_inherited := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'program_id', p_program_id,
    'team_inherited', v_team_inherited,
    'manual_staff_preserved', v_has_non_program_staff
  );
end;
$$;

revoke all on function public.apply_mapped_training_program_to_session_internal(uuid, uuid, uuid) from public;
revoke all on function public.apply_mapped_training_program_to_session_internal(uuid, uuid, uuid) from authenticated;

-- Internal schedule sync for one program. Only future scheduled sessions without a Training Log
-- are changed. Historical and completed/cancelled sessions are preserved.
create or replace function public.sync_training_program_schedule_internal(
  p_program_id uuid,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_status text;
  v_start date;
  v_end date;
  v_today date := ((now() at time zone 'Africa/Cairo')::date);
  v_row record;
  v_result jsonb;
  v_linked integer := 0;
  v_unlinked integer := 0;
  v_conflicts integer := 0;
  v_already integer := 0;
  v_template_count integer := 0;
begin
  select pr.status, pr.start_date, pr.end_date
    into v_status, v_start, v_end
  from public.coach_training_programs pr
  where pr.id = p_program_id;

  if not found then
    raise exception 'PROGRAM_NOT_FOUND' using errcode = 'P0002';
  end if;

  select count(*)::integer
    into v_template_count
  from public.coach_training_program_class_templates m
  where m.program_id = p_program_id
    and m.is_active;

  if v_status = 'published' and v_template_count = 0 then
    raise exception 'PROGRAM_SCHEDULE_REQUIRED';
  end if;

  if v_status = 'published' and exists (
    select 1
    from public.coach_training_program_class_templates mine
    join public.coach_training_program_class_templates other
      on other.class_template_id = mine.class_template_id
     and other.is_active
     and other.program_id <> mine.program_id
    join public.coach_training_programs other_program
      on other_program.id = other.program_id
     and other_program.status = 'published'
    where mine.program_id = p_program_id
      and mine.is_active
      and other_program.start_date <= v_end
      and other_program.end_date >= v_start
  ) then
    raise exception 'PROGRAM_TEMPLATE_PERIOD_CONFLICT';
  end if;

  -- Remove future links that are no longer eligible for this program.
  for v_row in
    select a.training_session_id
    from public.schedule_session_training_program_assignments a
    join public.schedule_training_sessions s on s.id = a.training_session_id
    where a.program_id = p_program_id
      and a.is_active
      and s.status = 'scheduled'
      and s.session_date >= v_today
      and not exists (
        select 1
        from public.coach_training_session_logs l
        where l.training_session_id = a.training_session_id
      )
      and (
        v_status <> 'published'
        or s.session_date < v_start
        or s.session_date > v_end
        or not exists (
          select 1
          from public.coach_training_program_class_templates m
          where m.program_id = p_program_id
            and m.class_template_id = s.class_template_id
            and m.is_active
        )
      )
  loop
    if public.unlink_training_program_from_session_internal(v_row.training_session_id, p_program_id, v_actor) then
      v_unlinked := v_unlinked + 1;
    end if;
  end loop;

  if v_status = 'published' then
    for v_row in
      select s.id
      from public.schedule_training_sessions s
      join public.coach_training_program_class_templates m
        on m.class_template_id = s.class_template_id
       and m.program_id = p_program_id
       and m.is_active
      where s.status = 'scheduled'
        and s.session_date >= greatest(v_today, v_start)
        and s.session_date <= v_end
        and not exists (
          select 1
          from public.coach_training_session_logs l
          where l.training_session_id = s.id
        )
      order by s.session_date, s.start_time, s.id
    loop
      v_result := public.apply_mapped_training_program_to_session_internal(v_row.id, p_program_id, v_actor);

      if coalesce((v_result ->> 'conflict')::boolean, false) then
        v_conflicts := v_conflicts + 1;
      elsif coalesce((v_result ->> 'changed')::boolean, false) then
        v_linked := v_linked + 1;
      else
        v_already := v_already + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'program_id', p_program_id,
    'status', v_status,
    'templates', v_template_count,
    'linked', v_linked,
    'unlinked', v_unlinked,
    'conflicts', v_conflicts,
    'already_linked', v_already
  );
end;
$$;

revoke all on function public.sync_training_program_schedule_internal(uuid, uuid) from public;
revoke all on function public.sync_training_program_schedule_internal(uuid, uuid) from authenticated;

-- Manager RPC: replace the active recurring Class Templates for a Training Program.
-- The call is idempotent and synchronizes all already-materialized future sessions.
create or replace function public.set_coach_training_program_schedule_templates(
  p_program_id uuid,
  p_template_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_status text;
  v_start date;
  v_end date;
  v_template_ids uuid[] := '{}'::uuid[];
  v_requested_count integer := 0;
  v_found_count integer := 0;
  v_sync jsonb;
begin
  if v_actor is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  select p.role::text
    into v_actor_role
  from public.profiles p
  where p.user_id = v_actor;

  if v_actor_role is null
     or v_actor_role <> all (array['head_coach','super_admin']::text[]) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select pr.status, pr.start_date, pr.end_date
    into v_status, v_start, v_end
  from public.coach_training_programs pr
  where pr.id = p_program_id
  for update;

  if not found then
    raise exception 'PROGRAM_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(distinct x order by x), '{}'::uuid[])
    into v_template_ids
  from unnest(coalesce(p_template_ids, '{}'::uuid[])) as x
  where x is not null;

  v_requested_count := cardinality(v_template_ids);

  if v_status = 'published' and v_requested_count = 0 then
    raise exception 'PROGRAM_SCHEDULE_REQUIRED';
  end if;

  if v_requested_count > 0 then
    select count(*)::integer
      into v_found_count
    from public.schedule_class_templates t
    where t.id = any (v_template_ids)
      and t.is_active;

    if v_found_count <> v_requested_count then
      raise exception 'INVALID_PROGRAM_CLASS_TEMPLATE';
    end if;
  end if;

  if v_status = 'published' and exists (
    select 1
    from unnest(v_template_ids) requested(template_id)
    join public.coach_training_program_class_templates other
      on other.class_template_id = requested.template_id
     and other.is_active
     and other.program_id <> p_program_id
    join public.coach_training_programs other_program
      on other_program.id = other.program_id
     and other_program.status = 'published'
    where other_program.start_date <= v_end
      and other_program.end_date >= v_start
  ) then
    raise exception 'PROGRAM_TEMPLATE_PERIOD_CONFLICT';
  end if;

  update public.coach_training_program_class_templates m
  set
    is_active = false,
    removed_by = v_actor,
    removed_at = now(),
    updated_at = now()
  where m.program_id = p_program_id
    and m.is_active
    and not (m.class_template_id = any (v_template_ids));

  -- Refresh snapshots for mappings that remain active.
  update public.coach_training_program_class_templates m
  set
    class_name_snapshot = t.name,
    series_key_snapshot = t.series_key,
    day_of_week_snapshot = t.day_of_week,
    start_time_snapshot = t.start_time,
    mat_snapshot = t.mat,
    updated_at = now()
  from public.schedule_class_templates t
  where m.program_id = p_program_id
    and m.class_template_id = t.id
    and m.is_active
    and m.class_template_id = any (v_template_ids);

  -- Insert only newly-selected mappings. Historical removed mappings remain as audit history.
  insert into public.coach_training_program_class_templates (
    program_id,
    class_template_id,
    class_name_snapshot,
    series_key_snapshot,
    day_of_week_snapshot,
    start_time_snapshot,
    mat_snapshot,
    assigned_by
  )
  select
    p_program_id,
    t.id,
    t.name,
    t.series_key,
    t.day_of_week,
    t.start_time,
    t.mat,
    v_actor
  from public.schedule_class_templates t
  where t.id = any (v_template_ids)
    and t.is_active
    and not exists (
      select 1
      from public.coach_training_program_class_templates current_mapping
      where current_mapping.program_id = p_program_id
        and current_mapping.class_template_id = t.id
        and current_mapping.is_active
    );

  v_sync := public.sync_training_program_schedule_internal(p_program_id, v_actor);

  return jsonb_build_object(
    'ok', true,
    'program_id', p_program_id,
    'templates', v_requested_count,
    'sync', v_sync
  );
end;
$$;

revoke all on function public.set_coach_training_program_schedule_templates(uuid, uuid[]) from public;
grant execute on function public.set_coach_training_program_schedule_templates(uuid, uuid[]) to authenticated;

-- A newly materialized dated session automatically receives its published mapped program.
create or replace function public.auto_apply_training_program_after_session_insert_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_program_id uuid;
begin
  select m.program_id
    into v_program_id
  from public.coach_training_program_class_templates m
  join public.coach_training_programs pr on pr.id = m.program_id
  where m.class_template_id = new.class_template_id
    and m.is_active
    and pr.status = 'published'
    and new.session_date between pr.start_date and pr.end_date
  order by pr.start_date desc, pr.created_at desc, pr.id
  limit 1;

  if v_program_id is not null then
    perform public.apply_mapped_training_program_to_session_internal(new.id, v_program_id, auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists auto_apply_training_program_after_session_insert on public.schedule_training_sessions;
create trigger auto_apply_training_program_after_session_insert
after insert on public.schedule_training_sessions
for each row execute function public.auto_apply_training_program_after_session_insert_trigger();

-- Publishing immediately links all eligible existing dated sessions. Unpublishing/archiving
-- removes only future no-log links created from that program.
create or replace function public.sync_training_program_schedule_after_status_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.status is distinct from old.status then
    perform public.sync_training_program_schedule_internal(new.id, coalesce(new.updated_by, auth.uid()));
  end if;
  return new;
end;
$$;

drop trigger if exists sync_training_program_schedule_after_status on public.coach_training_programs;
create trigger sync_training_program_schedule_after_status
after update of status on public.coach_training_programs
for each row execute function public.sync_training_program_schedule_after_status_trigger();

comment on table public.coach_training_program_class_templates is
  'Coach Operations: auditable recurring Class Template targets for Training Programs. Active mappings drive automatic program/team inheritance to dated sessions.';

commit;
