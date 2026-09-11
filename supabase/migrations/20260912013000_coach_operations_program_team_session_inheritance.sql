-- Coach Operations — Program Team Assignment & Session Inheritance
-- One responsible coach + up to two assistant coaches are assigned at Training Program level.
-- Dated sessions inherit that team when the program is linked. Responsible coach may adjust
-- assistants for an individual session without changing the program default team.

begin;

alter table public.coach_training_programs
  add column if not exists responsible_coach_user_id uuid null references auth.users(id) on delete restrict,
  add column if not exists responsible_coach_name_snapshot text null,
  add column if not exists responsible_coach_role_snapshot text null,
  add column if not exists assistant_coach_1_user_id uuid null references auth.users(id) on delete restrict,
  add column if not exists assistant_coach_1_name_snapshot text null,
  add column if not exists assistant_coach_1_role_snapshot text null,
  add column if not exists assistant_coach_2_user_id uuid null references auth.users(id) on delete restrict,
  add column if not exists assistant_coach_2_name_snapshot text null,
  add column if not exists assistant_coach_2_role_snapshot text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_training_programs_team_distinct_check'
      and conrelid = 'public.coach_training_programs'::regclass
  ) then
    alter table public.coach_training_programs
      add constraint coach_training_programs_team_distinct_check check (
        (assistant_coach_1_user_id is null or responsible_coach_user_id is null or assistant_coach_1_user_id <> responsible_coach_user_id)
        and (assistant_coach_2_user_id is null or responsible_coach_user_id is null or assistant_coach_2_user_id <> responsible_coach_user_id)
        and (assistant_coach_1_user_id is null or assistant_coach_2_user_id is null or assistant_coach_1_user_id <> assistant_coach_2_user_id)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_training_programs_responsible_role_check'
      and conrelid = 'public.coach_training_programs'::regclass
  ) then
    alter table public.coach_training_programs
      add constraint coach_training_programs_responsible_role_check check (
        responsible_coach_role_snapshot is null
        or responsible_coach_role_snapshot in ('assistant_coach','coach','head_coach','super_admin')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_training_programs_assistant1_role_check'
      and conrelid = 'public.coach_training_programs'::regclass
  ) then
    alter table public.coach_training_programs
      add constraint coach_training_programs_assistant1_role_check check (
        assistant_coach_1_role_snapshot is null
        or assistant_coach_1_role_snapshot in ('assistant_coach','coach','head_coach','super_admin')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_training_programs_assistant2_role_check'
      and conrelid = 'public.coach_training_programs'::regclass
  ) then
    alter table public.coach_training_programs
      add constraint coach_training_programs_assistant2_role_check check (
        assistant_coach_2_role_snapshot is null
        or assistant_coach_2_role_snapshot in ('assistant_coach','coach','head_coach','super_admin')
      );
  end if;
end
$$;

create or replace function public.coach_training_program_team_snapshot_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_name text;
  v_role text;
begin
  if tg_op = 'UPDATE'
     and new.responsible_coach_user_id is not distinct from old.responsible_coach_user_id
     and new.assistant_coach_1_user_id is not distinct from old.assistant_coach_1_user_id
     and new.assistant_coach_2_user_id is not distinct from old.assistant_coach_2_user_id then
    if new.status = 'published' and new.responsible_coach_user_id is null then
      raise exception 'PROGRAM_RESPONSIBLE_COACH_REQUIRED';
    end if;
    return new;
  end if;

  if new.responsible_coach_user_id is not null then
    select
      coalesce(
        nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
        nullif(btrim(p.email), ''),
        'Staff'
      ),
      p.role::text
      into v_name, v_role
    from public.profiles p
    where p.user_id = new.responsible_coach_user_id;

    if not found or v_role <> all (array['assistant_coach','coach','head_coach','super_admin']::text[]) then
      raise exception 'INVALID_PROGRAM_RESPONSIBLE_COACH';
    end if;

    new.responsible_coach_name_snapshot := v_name;
    new.responsible_coach_role_snapshot := v_role;
  else
    new.responsible_coach_name_snapshot := null;
    new.responsible_coach_role_snapshot := null;
  end if;

  if new.assistant_coach_1_user_id is not null then
    select
      coalesce(
        nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
        nullif(btrim(p.email), ''),
        'Staff'
      ),
      p.role::text
      into v_name, v_role
    from public.profiles p
    where p.user_id = new.assistant_coach_1_user_id;

    if not found or v_role <> all (array['assistant_coach','coach','head_coach','super_admin']::text[]) then
      raise exception 'INVALID_PROGRAM_ASSISTANT_COACH';
    end if;

    new.assistant_coach_1_name_snapshot := v_name;
    new.assistant_coach_1_role_snapshot := v_role;
  else
    new.assistant_coach_1_name_snapshot := null;
    new.assistant_coach_1_role_snapshot := null;
  end if;

  if new.assistant_coach_2_user_id is not null then
    select
      coalesce(
        nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
        nullif(btrim(p.email), ''),
        'Staff'
      ),
      p.role::text
      into v_name, v_role
    from public.profiles p
    where p.user_id = new.assistant_coach_2_user_id;

    if not found or v_role <> all (array['assistant_coach','coach','head_coach','super_admin']::text[]) then
      raise exception 'INVALID_PROGRAM_ASSISTANT_COACH';
    end if;

    new.assistant_coach_2_name_snapshot := v_name;
    new.assistant_coach_2_role_snapshot := v_role;
  else
    new.assistant_coach_2_name_snapshot := null;
    new.assistant_coach_2_role_snapshot := null;
  end if;

  if new.responsible_coach_user_id is not null
     and (
       new.responsible_coach_user_id = new.assistant_coach_1_user_id
       or new.responsible_coach_user_id = new.assistant_coach_2_user_id
     ) then
    raise exception 'DUPLICATE_PROGRAM_TEAM_MEMBER';
  end if;

  if new.assistant_coach_1_user_id is not null
     and new.assistant_coach_1_user_id = new.assistant_coach_2_user_id then
    raise exception 'DUPLICATE_PROGRAM_TEAM_MEMBER';
  end if;

  if new.status = 'published' and new.responsible_coach_user_id is null then
    raise exception 'PROGRAM_RESPONSIBLE_COACH_REQUIRED';
  end if;

  return new;
end;
$$;

drop trigger if exists coach_training_program_team_snapshot_before_write on public.coach_training_programs;
create trigger coach_training_program_team_snapshot_before_write
before insert or update on public.coach_training_programs
for each row execute function public.coach_training_program_team_snapshot_trigger();

alter table public.schedule_session_coach_assignments
  add column if not exists assignment_source text not null default 'manual',
  add column if not exists source_program_id uuid null references public.coach_training_programs(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'schedule_session_coach_assignments_source_check'
      and conrelid = 'public.schedule_session_coach_assignments'::regclass
  ) then
    alter table public.schedule_session_coach_assignments
      add constraint schedule_session_coach_assignments_source_check
      check (assignment_source in ('manual','program','session_override'));
  end if;
end
$$;

create index if not exists schedule_session_coach_assignments_program_source_idx
  on public.schedule_session_coach_assignments (source_program_id, assignment_source, is_active, training_session_id);

create or replace function public.apply_training_program_team_to_session(
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
  v_responsible uuid;
  v_assistants uuid[] := '{}'::uuid[];
  v_staff_user_id uuid;
  v_staff_name text;
  v_staff_role text;
  v_removed integer := 0;
  v_added integer := 0;
begin
  select
    pr.responsible_coach_user_id,
    array_remove(array[pr.assistant_coach_1_user_id, pr.assistant_coach_2_user_id]::uuid[], null)
    into v_responsible, v_assistants
  from public.coach_training_programs pr
  where pr.id = p_program_id;

  if not found then
    raise exception 'PROGRAM_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_responsible is null then
    raise exception 'PROGRAM_RESPONSIBLE_COACH_REQUIRED';
  end if;

  update public.schedule_session_coach_assignments a
  set
    is_active = false,
    removed_by = v_actor,
    removed_at = now(),
    updated_at = now()
  where a.training_session_id = p_session_id
    and a.is_active;

  get diagnostics v_removed = row_count;

  select
    coalesce(
      nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
      nullif(btrim(p.email), ''),
      'Staff'
    ),
    p.role::text
    into v_staff_name, v_staff_role
  from public.profiles p
  where p.user_id = v_responsible;

  if not found or v_staff_role <> all (array['assistant_coach','coach','head_coach','super_admin']::text[]) then
    raise exception 'INVALID_PROGRAM_RESPONSIBLE_COACH';
  end if;

  insert into public.schedule_session_coach_assignments (
    training_session_id,
    staff_user_id,
    assignment_role,
    staff_name_snapshot,
    staff_profile_role_snapshot,
    assignment_source,
    source_program_id,
    assigned_by
  ) values (
    p_session_id,
    v_responsible,
    'primary_coach',
    v_staff_name,
    v_staff_role,
    'program',
    p_program_id,
    v_actor
  );

  v_added := v_added + 1;

  foreach v_staff_user_id in array v_assistants
  loop
    select
      coalesce(
        nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
        nullif(btrim(p.email), ''),
        'Staff'
      ),
      p.role::text
      into v_staff_name, v_staff_role
    from public.profiles p
    where p.user_id = v_staff_user_id;

    if not found or v_staff_role <> all (array['assistant_coach','coach','head_coach','super_admin']::text[]) then
      raise exception 'INVALID_PROGRAM_ASSISTANT_COACH';
    end if;

    insert into public.schedule_session_coach_assignments (
      training_session_id,
      staff_user_id,
      assignment_role,
      staff_name_snapshot,
      staff_profile_role_snapshot,
      assignment_source,
      source_program_id,
      assigned_by
    ) values (
      p_session_id,
      v_staff_user_id,
      'assistant_coach',
      v_staff_name,
      v_staff_role,
      'program',
      p_program_id,
      v_actor
    );

    v_added := v_added + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'session_id', p_session_id,
    'program_id', p_program_id,
    'responsible_coach_user_id', v_responsible,
    'assistants', cardinality(v_assistants),
    'removed', v_removed,
    'added', v_added
  );
end;
$$;

revoke all on function public.apply_training_program_team_to_session(uuid, uuid, uuid) from public;
revoke all on function public.apply_training_program_team_to_session(uuid, uuid, uuid) from authenticated;

create or replace function public.sync_training_program_team_to_future_sessions_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row record;
  v_actor uuid := coalesce(new.updated_by, auth.uid());
begin
  if new.responsible_coach_user_id is not distinct from old.responsible_coach_user_id
     and new.assistant_coach_1_user_id is not distinct from old.assistant_coach_1_user_id
     and new.assistant_coach_2_user_id is not distinct from old.assistant_coach_2_user_id then
    return new;
  end if;

  if new.responsible_coach_user_id is null then
    return new;
  end if;

  for v_row in
    select a.training_session_id
    from public.schedule_session_training_program_assignments a
    join public.schedule_training_sessions s on s.id = a.training_session_id
    where a.program_id = new.id
      and a.is_active
      and s.status = 'scheduled'
      and s.session_date >= ((now() at time zone 'Africa/Cairo')::date)
      and not exists (
        select 1
        from public.coach_training_session_logs l
        where l.training_session_id = a.training_session_id
      )
      and (
        old.responsible_coach_user_id is null
        or not exists (
          select 1
          from public.schedule_session_coach_assignments sca
          where sca.training_session_id = a.training_session_id
            and sca.is_active
            and sca.assignment_source <> 'program'
        )
      )
  loop
    perform public.apply_training_program_team_to_session(v_row.training_session_id, new.id, v_actor);
  end loop;

  return new;
end;
$$;

drop trigger if exists sync_training_program_team_to_future_sessions_after_update on public.coach_training_programs;
create trigger sync_training_program_team_to_future_sessions_after_update
after update of responsible_coach_user_id, assistant_coach_1_user_id, assistant_coach_2_user_id
on public.coach_training_programs
for each row execute function public.sync_training_program_team_to_future_sessions_trigger();

create or replace function public.set_schedule_session_coach_assignments(
  p_session_id uuid,
  p_primary_user_id uuid default null,
  p_assistant_user_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_is_manager boolean := false;
  v_actor_is_primary boolean := false;
  v_session_status text;
  v_primary_user_id uuid := p_primary_user_id;
  v_assistants uuid[] := '{}'::uuid[];
  v_assistant_limit integer := 6;
  v_staff_user_id uuid;
  v_staff_name text;
  v_staff_role text;
  v_removed integer := 0;
  v_added integer := 0;
  v_active integer := 0;
  v_program_id uuid;
begin
  if v_actor is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  select p.role::text
    into v_actor_role
  from public.profiles p
  where p.user_id = v_actor;

  v_is_manager := v_actor_role = any (array['head_coach','super_admin']::text[]);

  select s.status
    into v_session_status
  from public.schedule_training_sessions s
  where s.id = p_session_id
  for update;

  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_session_status <> 'scheduled' then
    raise exception 'SESSION_NOT_SCHEDULED';
  end if;

  select exists (
    select 1
    from public.schedule_session_coach_assignments a
    where a.training_session_id = p_session_id
      and a.staff_user_id = v_actor
      and a.assignment_role = 'primary_coach'
      and a.is_active
  ) into v_actor_is_primary;

  if not v_is_manager and not v_actor_is_primary then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if not v_is_manager then
    v_primary_user_id := v_actor;
    v_assistant_limit := 2;

    if exists (
      select 1
      from public.coach_training_session_logs l
      where l.training_session_id = p_session_id
        and l.status = 'completed'
    ) then
      raise exception 'SESSION_LOG_COMPLETED';
    end if;
  end if;

  select coalesce(array_agg(distinct x), '{}'::uuid[])
    into v_assistants
  from unnest(coalesce(p_assistant_user_ids, '{}'::uuid[])) as x
  where x is not null
    and (v_primary_user_id is null or x <> v_primary_user_id);

  if cardinality(v_assistants) > v_assistant_limit then
    raise exception 'TOO_MANY_ASSISTANTS';
  end if;

  if v_primary_user_id is null and cardinality(v_assistants) > 0 then
    raise exception 'PRIMARY_COACH_REQUIRED';
  end if;

  if v_primary_user_id is not null then
    select
      coalesce(
        nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
        nullif(btrim(p.email), ''),
        'Staff'
      ),
      p.role::text
      into v_staff_name, v_staff_role
    from public.profiles p
    where p.user_id = v_primary_user_id;

    if not found
       or v_staff_role <> all (array['assistant_coach','coach','head_coach','super_admin']::text[]) then
      raise exception 'INVALID_PRIMARY_COACH';
    end if;
  end if;

  foreach v_staff_user_id in array v_assistants
  loop
    select
      coalesce(
        nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
        nullif(btrim(p.email), ''),
        'Staff'
      ),
      p.role::text
      into v_staff_name, v_staff_role
    from public.profiles p
    where p.user_id = v_staff_user_id;

    if not found
       or v_staff_role <> all (array['assistant_coach','coach','head_coach','super_admin']::text[]) then
      raise exception 'INVALID_ASSISTANT_COACH';
    end if;
  end loop;

  select a.program_id
    into v_program_id
  from public.schedule_session_training_program_assignments a
  where a.training_session_id = p_session_id
    and a.is_active
  limit 1;

  update public.schedule_session_coach_assignments a
  set
    is_active = false,
    removed_by = v_actor,
    removed_at = now(),
    updated_at = now()
  where a.training_session_id = p_session_id
    and a.is_active
    and not (
      (
        a.assignment_role = 'primary_coach'
        and v_primary_user_id is not null
        and a.staff_user_id = v_primary_user_id
      )
      or
      (
        a.assignment_role = 'assistant_coach'
        and a.staff_user_id = any (v_assistants)
      )
    );

  get diagnostics v_removed = row_count;

  if v_primary_user_id is not null
     and not exists (
       select 1
       from public.schedule_session_coach_assignments a
       where a.training_session_id = p_session_id
         and a.staff_user_id = v_primary_user_id
         and a.assignment_role = 'primary_coach'
         and a.is_active
     ) then
    select
      coalesce(
        nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
        nullif(btrim(p.email), ''),
        'Staff'
      ),
      p.role::text
      into v_staff_name, v_staff_role
    from public.profiles p
    where p.user_id = v_primary_user_id;

    insert into public.schedule_session_coach_assignments (
      training_session_id,
      staff_user_id,
      assignment_role,
      staff_name_snapshot,
      staff_profile_role_snapshot,
      assignment_source,
      source_program_id,
      assigned_by
    ) values (
      p_session_id,
      v_primary_user_id,
      'primary_coach',
      v_staff_name,
      v_staff_role,
      case when v_is_manager then 'manual' else 'session_override' end,
      case when v_is_manager then null else v_program_id end,
      v_actor
    );

    v_added := v_added + 1;
  end if;

  foreach v_staff_user_id in array v_assistants
  loop
    if not exists (
      select 1
      from public.schedule_session_coach_assignments a
      where a.training_session_id = p_session_id
        and a.staff_user_id = v_staff_user_id
        and a.assignment_role = 'assistant_coach'
        and a.is_active
    ) then
      select
        coalesce(
          nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
          nullif(btrim(p.email), ''),
          'Staff'
        ),
        p.role::text
        into v_staff_name, v_staff_role
      from public.profiles p
      where p.user_id = v_staff_user_id;

      insert into public.schedule_session_coach_assignments (
        training_session_id,
        staff_user_id,
        assignment_role,
        staff_name_snapshot,
        staff_profile_role_snapshot,
        assignment_source,
        source_program_id,
        assigned_by
      ) values (
        p_session_id,
        v_staff_user_id,
        'assistant_coach',
        v_staff_name,
        v_staff_role,
        case when v_is_manager then 'manual' else 'session_override' end,
        case when v_is_manager then null else v_program_id end,
        v_actor
      );

      v_added := v_added + 1;
    end if;
  end loop;

  if v_is_manager then
    update public.schedule_session_coach_assignments a
    set assignment_source = 'manual',
        source_program_id = null,
        updated_at = now()
    where a.training_session_id = p_session_id
      and a.is_active;
  else
    update public.schedule_session_coach_assignments a
    set assignment_source = 'session_override',
        source_program_id = v_program_id,
        updated_at = now()
    where a.training_session_id = p_session_id
      and a.staff_user_id = v_actor
      and a.assignment_role = 'primary_coach'
      and a.is_active;
  end if;

  select count(*)
    into v_active
  from public.schedule_session_coach_assignments a
  where a.training_session_id = p_session_id
    and a.is_active;

  return jsonb_build_object(
    'ok', true,
    'session_id', p_session_id,
    'added', v_added,
    'removed', v_removed,
    'active', v_active,
    'mode', case when v_is_manager then 'manager' else 'responsible_coach' end
  );
end;
$$;

revoke all on function public.set_schedule_session_coach_assignments(uuid, uuid, uuid[]) from public;
grant execute on function public.set_schedule_session_coach_assignments(uuid, uuid, uuid[]) to authenticated;

create or replace function public.set_schedule_session_training_program(
  p_session_id uuid,
  p_program_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_session_date date;
  v_session_status text;
  v_program_title text;
  v_program_group text;
  v_program_start date;
  v_program_end date;
  v_program_status text;
  v_program_responsible uuid;
  v_current_id uuid;
  v_current_program_id uuid;
  v_has_log boolean := false;
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

  select s.session_date, s.status
    into v_session_date, v_session_status
  from public.schedule_training_sessions s
  where s.id = p_session_id
  for update;

  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_session_status <> 'scheduled' then
    raise exception 'SESSION_NOT_SCHEDULED';
  end if;

  select a.id, a.program_id
    into v_current_id, v_current_program_id
  from public.schedule_session_training_program_assignments a
  where a.training_session_id = p_session_id
    and a.is_active
  limit 1;

  select exists (
    select 1
    from public.coach_training_session_logs l
    where l.training_session_id = p_session_id
  ) into v_has_log;

  if p_program_id is null then
    if v_current_id is null then
      return jsonb_build_object('ok', true, 'session_id', p_session_id, 'program_id', null, 'changed', false);
    end if;

    if v_has_log then
      raise exception 'SESSION_HAS_TRAINING_LOG';
    end if;

    update public.schedule_session_training_program_assignments
    set is_active = false,
        removed_by = v_actor,
        removed_at = now(),
        updated_at = now()
    where id = v_current_id;

    update public.schedule_session_coach_assignments a
    set is_active = false,
        removed_by = v_actor,
        removed_at = now(),
        updated_at = now()
    where a.training_session_id = p_session_id
      and a.is_active
      and a.source_program_id = v_current_program_id
      and a.assignment_source in ('program','session_override');

    return jsonb_build_object('ok', true, 'session_id', p_session_id, 'program_id', null, 'changed', true);
  end if;

  if v_current_program_id = p_program_id then
    return jsonb_build_object('ok', true, 'session_id', p_session_id, 'program_id', p_program_id, 'changed', false);
  end if;

  if v_has_log then
    raise exception 'SESSION_HAS_TRAINING_LOG';
  end if;

  select pr.title, pr.target_group, pr.start_date, pr.end_date, pr.status, pr.responsible_coach_user_id
    into v_program_title, v_program_group, v_program_start, v_program_end, v_program_status, v_program_responsible
  from public.coach_training_programs pr
  where pr.id = p_program_id;

  if not found or v_program_status <> 'published' then
    raise exception 'PUBLISHED_PROGRAM_NOT_FOUND';
  end if;

  if v_program_responsible is null then
    raise exception 'PROGRAM_RESPONSIBLE_COACH_REQUIRED';
  end if;

  if v_session_date < v_program_start or v_session_date > v_program_end then
    raise exception 'SESSION_OUTSIDE_PROGRAM_PERIOD';
  end if;

  if v_current_id is not null then
    update public.schedule_session_training_program_assignments
    set is_active = false,
        removed_by = v_actor,
        removed_at = now(),
        updated_at = now()
    where id = v_current_id;
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

  perform public.apply_training_program_team_to_session(p_session_id, p_program_id, v_actor);

  return jsonb_build_object('ok', true, 'session_id', p_session_id, 'program_id', p_program_id, 'changed', true, 'team_inherited', true);
end;
$$;

revoke all on function public.set_schedule_session_training_program(uuid, uuid) from public;
grant execute on function public.set_schedule_session_training_program(uuid, uuid) to authenticated;

-- Linked scheduled-session logs are authored by the responsible / primary coach.
-- Head Coach and Super Admin retain manager access.
drop policy if exists coach_training_session_logs_insert_coaching_staff on public.coach_training_session_logs;
create policy coach_training_session_logs_insert_coaching_staff
on public.coach_training_session_logs
for insert to authenticated
with check (
  coach_user_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.role::text = any (array['assistant_coach','coach','head_coach','super_admin']::text[])
  )
  and (
    training_session_id is null
    or exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role::text = any (array['head_coach','super_admin']::text[])
    )
    or exists (
      select 1
      from public.schedule_session_coach_assignments a
      where a.training_session_id = coach_training_session_logs.training_session_id
        and a.staff_user_id = auth.uid()
        and a.assignment_role = 'primary_coach'
        and a.is_active
    )
  )
);

drop policy if exists coach_training_session_logs_update_staff on public.coach_training_session_logs;
create policy coach_training_session_logs_update_staff
on public.coach_training_session_logs
for update to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and (
        p.role::text = any (array['head_coach','super_admin']::text[])
        or (
          p.role::text = any (array['assistant_coach','coach']::text[])
          and coach_training_session_logs.coach_user_id = auth.uid()
          and coach_training_session_logs.status = 'draft'
        )
      )
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and (
        p.role::text = any (array['head_coach','super_admin']::text[])
        or (
          p.role::text = any (array['assistant_coach','coach']::text[])
          and coach_training_session_logs.coach_user_id = auth.uid()
          and (
            coach_training_session_logs.training_session_id is null
            or exists (
              select 1
              from public.schedule_session_coach_assignments a
              where a.training_session_id = coach_training_session_logs.training_session_id
                and a.staff_user_id = auth.uid()
                and a.assignment_role = 'primary_coach'
                and a.is_active
            )
          )
        )
      )
  )
);

comment on column public.coach_training_programs.responsible_coach_user_id is
  'Responsible coach for this Training Program. Dated sessions inherit this coach as Primary Coach when linked to the program.';
comment on column public.coach_training_programs.assistant_coach_1_user_id is
  'Optional first default assistant coach inherited by dated sessions.';
comment on column public.coach_training_programs.assistant_coach_2_user_id is
  'Optional second default assistant coach inherited by dated sessions.';
comment on column public.schedule_session_coach_assignments.assignment_source is
  'manual = manager/session exception, program = inherited from Training Program, session_override = responsible coach changed assistants for this session.';
comment on function public.set_schedule_session_coach_assignments(uuid, uuid, uuid[]) is
  'Head Coach/Super Admin can manage the full session team. The active Primary Coach can change only assistants for their own scheduled session, up to two.';
comment on function public.set_schedule_session_training_program(uuid, uuid) is
  'Head Coach/Super Admin only. Assigns one published Training Program and automatically inherits its responsible/assistant coaching team into the dated session.';

commit;
