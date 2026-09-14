-- Structured Schedule — Default Coaching Team by Recurring Class Series
-- Head Coach / Super Admin assign the normal coaching team once per recurring
-- schedule series (for example Teens 10–14 Intermediate). Future dated sessions
-- inherit that team automatically. Dated-session staff changes remain explicit
-- overrides and historical / completed / logged sessions are preserved.

begin;

create table if not exists public.schedule_series_coaching_teams (
  series_key text primary key,
  primary_coach_user_id uuid not null references auth.users(id) on delete restrict,
  primary_coach_name_snapshot text not null,
  primary_coach_role_snapshot text not null,
  assistant_coach_1_user_id uuid null references auth.users(id) on delete restrict,
  assistant_coach_1_name_snapshot text null,
  assistant_coach_1_role_snapshot text null,
  assistant_coach_2_user_id uuid null references auth.users(id) on delete restrict,
  assistant_coach_2_name_snapshot text null,
  assistant_coach_2_role_snapshot text null,
  is_active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_series_coaching_teams_series_key_check
    check (series_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint schedule_series_coaching_teams_primary_name_check
    check (char_length(btrim(primary_coach_name_snapshot)) between 1 and 180),
  constraint schedule_series_coaching_teams_primary_role_check
    check (primary_coach_role_snapshot in ('assistant_coach','coach','head_coach','super_admin')),
  constraint schedule_series_coaching_teams_assistant_1_state_check
    check (
      (assistant_coach_1_user_id is null and assistant_coach_1_name_snapshot is null and assistant_coach_1_role_snapshot is null)
      or
      (
        assistant_coach_1_user_id is not null
        and assistant_coach_1_name_snapshot is not null
        and char_length(btrim(assistant_coach_1_name_snapshot)) between 1 and 180
        and assistant_coach_1_role_snapshot in ('assistant_coach','coach','head_coach','super_admin')
      )
    ),
  constraint schedule_series_coaching_teams_assistant_2_state_check
    check (
      (assistant_coach_2_user_id is null and assistant_coach_2_name_snapshot is null and assistant_coach_2_role_snapshot is null)
      or
      (
        assistant_coach_2_user_id is not null
        and assistant_coach_2_name_snapshot is not null
        and char_length(btrim(assistant_coach_2_name_snapshot)) between 1 and 180
        and assistant_coach_2_role_snapshot in ('assistant_coach','coach','head_coach','super_admin')
      )
    ),
  constraint schedule_series_coaching_teams_distinct_staff_check
    check (
      (assistant_coach_1_user_id is null or assistant_coach_1_user_id <> primary_coach_user_id)
      and (assistant_coach_2_user_id is null or assistant_coach_2_user_id <> primary_coach_user_id)
      and (
        assistant_coach_1_user_id is null
        or assistant_coach_2_user_id is null
        or assistant_coach_1_user_id <> assistant_coach_2_user_id
      )
    )
);

create index if not exists schedule_series_coaching_teams_active_idx
  on public.schedule_series_coaching_teams (is_active, series_key);

alter table public.schedule_series_coaching_teams enable row level security;

grant select on public.schedule_series_coaching_teams to authenticated;
revoke insert, update, delete on public.schedule_series_coaching_teams from authenticated;

drop policy if exists schedule_series_coaching_teams_read_coaching_staff
  on public.schedule_series_coaching_teams;
create policy schedule_series_coaching_teams_read_coaching_staff
on public.schedule_series_coaching_teams
for select to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role::text = any (array['assistant_coach','coach','head_coach','super_admin']::text[])
  )
);

-- Add an explicit source for recurring-schedule defaults. This keeps the source
-- distinguishable from technical Training Program inheritance and deliberate
-- one-session overrides.
alter table public.schedule_session_coach_assignments
  drop constraint if exists schedule_session_coach_assignments_source_check;

alter table public.schedule_session_coach_assignments
  add constraint schedule_session_coach_assignments_source_check
  check (assignment_source in ('manual','program','session_override','schedule_default'));

-- Internal helper. Schedule defaults replace only automatic Training Program
-- staff. They never overwrite manager / Responsible Coach session overrides.
create or replace function public.apply_schedule_series_coaching_team_to_session_internal(
  p_session_id uuid,
  p_series_key text,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_session_series text;
  v_session_date date;
  v_session_status text;
  v_today date := ((now() at time zone 'Africa/Cairo')::date);
  v_team public.schedule_series_coaching_teams%rowtype;
  v_has_override boolean := false;
  v_removed integer := 0;
  v_added integer := 0;
begin
  select s.series_key_snapshot, s.session_date, s.status
    into v_session_series, v_session_date, v_session_status
  from public.schedule_training_sessions s
  where s.id = p_session_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'SESSION_NOT_FOUND');
  end if;

  if v_session_status <> 'scheduled' then
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'SESSION_NOT_SCHEDULED');
  end if;

  if v_session_date < v_today then
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'HISTORICAL_SESSION');
  end if;

  if v_session_series <> p_series_key then
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'SERIES_MISMATCH');
  end if;

  if exists (
    select 1
    from public.coach_training_session_logs l
    where l.training_session_id = p_session_id
  ) then
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'SESSION_HAS_TRAINING_LOG');
  end if;

  select *
    into v_team
  from public.schedule_series_coaching_teams t
  where t.series_key = p_series_key
    and t.is_active;

  if not found then
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'NO_ACTIVE_DEFAULT_TEAM');
  end if;

  select exists (
    select 1
    from public.schedule_session_coach_assignments a
    where a.training_session_id = p_session_id
      and a.is_active
      and a.assignment_source in ('manual','session_override')
  ) into v_has_override;

  if v_has_override then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'reason', 'SESSION_OVERRIDE_PRESERVED'
    );
  end if;

  update public.schedule_session_coach_assignments a
  set
    is_active = false,
    removed_by = v_actor,
    removed_at = now(),
    updated_at = now()
  where a.training_session_id = p_session_id
    and a.is_active
    and a.assignment_source in ('program','schedule_default');

  get diagnostics v_removed = row_count;

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
    v_team.primary_coach_user_id,
    'primary_coach',
    v_team.primary_coach_name_snapshot,
    v_team.primary_coach_role_snapshot,
    'schedule_default',
    null,
    v_actor
  );
  v_added := v_added + 1;

  if v_team.assistant_coach_1_user_id is not null then
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
      v_team.assistant_coach_1_user_id,
      'assistant_coach',
      v_team.assistant_coach_1_name_snapshot,
      v_team.assistant_coach_1_role_snapshot,
      'schedule_default',
      null,
      v_actor
    );
    v_added := v_added + 1;
  end if;

  if v_team.assistant_coach_2_user_id is not null then
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
      v_team.assistant_coach_2_user_id,
      'assistant_coach',
      v_team.assistant_coach_2_name_snapshot,
      v_team.assistant_coach_2_role_snapshot,
      'schedule_default',
      null,
      v_actor
    );
    v_added := v_added + 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'series_key', p_series_key,
    'removed', v_removed,
    'added', v_added,
    'source', 'schedule_default'
  );
end;
$$;

revoke all on function public.apply_schedule_series_coaching_team_to_session_internal(uuid, text, uuid) from public;
revoke all on function public.apply_schedule_series_coaching_team_to_session_internal(uuid, text, uuid) from authenticated;

-- Internal resync after a default team changes. Only future scheduled sessions
-- without a Training Log are touched. Manual / session overrides are preserved.
create or replace function public.sync_schedule_series_coaching_team_internal(
  p_series_key text,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_today date := ((now() at time zone 'Africa/Cairo')::date);
  v_has_team boolean := false;
  v_row record;
  v_result jsonb;
  v_applied integer := 0;
  v_preserved integer := 0;
  v_removed integer := 0;
  v_program_id uuid;
begin
  select exists (
    select 1
    from public.schedule_series_coaching_teams t
    where t.series_key = p_series_key
      and t.is_active
  ) into v_has_team;

  for v_row in
    select s.id
    from public.schedule_training_sessions s
    where s.series_key_snapshot = p_series_key
      and s.status = 'scheduled'
      and s.session_date >= v_today
      and not exists (
        select 1
        from public.coach_training_session_logs l
        where l.training_session_id = s.id
      )
    order by s.session_date, s.start_time
  loop
    if v_has_team then
      v_result := public.apply_schedule_series_coaching_team_to_session_internal(
        v_row.id,
        p_series_key,
        v_actor
      );

      if coalesce((v_result ->> 'changed')::boolean, false) then
        v_applied := v_applied + 1;
      elsif v_result ->> 'reason' = 'SESSION_OVERRIDE_PRESERVED' then
        v_preserved := v_preserved + 1;
      end if;
    else
      -- Clearing a series default removes only schedule-default rows. A deliberate
      -- dated-session override is never touched. If the session has a technical
      -- Training Program and no override, its Program team becomes the fallback.
      if not exists (
        select 1
        from public.schedule_session_coach_assignments a
        where a.training_session_id = v_row.id
          and a.is_active
          and a.assignment_source in ('manual','session_override')
      ) then
        update public.schedule_session_coach_assignments a
        set
          is_active = false,
          removed_by = v_actor,
          removed_at = now(),
          updated_at = now()
        where a.training_session_id = v_row.id
          and a.is_active
          and a.assignment_source = 'schedule_default';

        if found then
          v_removed := v_removed + 1;
        end if;

        select a.program_id
          into v_program_id
        from public.schedule_session_training_program_assignments a
        where a.training_session_id = v_row.id
          and a.is_active
        limit 1;

        if v_program_id is not null then
          perform public.apply_training_program_team_to_session(v_row.id, v_program_id, v_actor);
        end if;
      else
        v_preserved := v_preserved + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'series_key', p_series_key,
    'active_default', v_has_team,
    'applied_sessions', v_applied,
    'removed_default_sessions', v_removed,
    'preserved_overrides', v_preserved
  );
end;
$$;

revoke all on function public.sync_schedule_series_coaching_team_internal(text, uuid) from public;
revoke all on function public.sync_schedule_series_coaching_team_internal(text, uuid) from authenticated;

-- Manager entry point used by the Scheduled Sessions UI.
create or replace function public.set_schedule_series_coaching_team(
  p_series_key text,
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
  v_series_key text := btrim(coalesce(p_series_key, ''));
  v_assistants uuid[] := '{}'::uuid[];
  v_assistant_1 uuid;
  v_assistant_2 uuid;
  v_primary_name text;
  v_primary_role text;
  v_assistant_1_name text;
  v_assistant_1_role text;
  v_assistant_2_name text;
  v_assistant_2_role text;
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

  if v_series_key = '' then
    raise exception 'INVALID_SERIES_KEY';
  end if;

  if not exists (
    select 1
    from public.schedule_class_templates t
    where t.series_key = v_series_key
      and t.is_active
  ) then
    raise exception 'SERIES_NOT_FOUND';
  end if;

  select coalesce(array_agg(distinct x), '{}'::uuid[])
    into v_assistants
  from unnest(coalesce(p_assistant_user_ids, '{}'::uuid[])) as x
  where x is not null
    and (p_primary_user_id is null or x <> p_primary_user_id);

  if cardinality(v_assistants) > 2 then
    raise exception 'TOO_MANY_ASSISTANTS';
  end if;

  if p_primary_user_id is null and cardinality(v_assistants) > 0 then
    raise exception 'PRIMARY_COACH_REQUIRED';
  end if;

  if p_primary_user_id is null then
    update public.schedule_series_coaching_teams
    set
      is_active = false,
      updated_by = v_actor,
      updated_at = now()
    where series_key = v_series_key
      and is_active;

    v_sync := public.sync_schedule_series_coaching_team_internal(v_series_key, v_actor);

    return jsonb_build_object(
      'ok', true,
      'series_key', v_series_key,
      'cleared', true,
      'sync', v_sync
    );
  end if;

  select
    coalesce(
      nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
      nullif(btrim(p.email), ''),
      'Staff'
    ),
    p.role::text
    into v_primary_name, v_primary_role
  from public.profiles p
  where p.user_id = p_primary_user_id;

  if not found
     or v_primary_role <> all (array['assistant_coach','coach','head_coach','super_admin']::text[]) then
    raise exception 'INVALID_PRIMARY_COACH';
  end if;

  v_assistant_1 := v_assistants[1];
  v_assistant_2 := v_assistants[2];

  if v_assistant_1 is not null then
    select
      coalesce(
        nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
        nullif(btrim(p.email), ''),
        'Staff'
      ),
      p.role::text
      into v_assistant_1_name, v_assistant_1_role
    from public.profiles p
    where p.user_id = v_assistant_1;

    if not found
       or v_assistant_1_role <> all (array['assistant_coach','coach','head_coach','super_admin']::text[]) then
      raise exception 'INVALID_ASSISTANT_COACH';
    end if;
  end if;

  if v_assistant_2 is not null then
    select
      coalesce(
        nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
        nullif(btrim(p.email), ''),
        'Staff'
      ),
      p.role::text
      into v_assistant_2_name, v_assistant_2_role
    from public.profiles p
    where p.user_id = v_assistant_2;

    if not found
       or v_assistant_2_role <> all (array['assistant_coach','coach','head_coach','super_admin']::text[]) then
      raise exception 'INVALID_ASSISTANT_COACH';
    end if;
  end if;

  insert into public.schedule_series_coaching_teams (
    series_key,
    primary_coach_user_id,
    primary_coach_name_snapshot,
    primary_coach_role_snapshot,
    assistant_coach_1_user_id,
    assistant_coach_1_name_snapshot,
    assistant_coach_1_role_snapshot,
    assistant_coach_2_user_id,
    assistant_coach_2_name_snapshot,
    assistant_coach_2_role_snapshot,
    is_active,
    created_by,
    updated_by,
    updated_at
  ) values (
    v_series_key,
    p_primary_user_id,
    v_primary_name,
    v_primary_role,
    v_assistant_1,
    v_assistant_1_name,
    v_assistant_1_role,
    v_assistant_2,
    v_assistant_2_name,
    v_assistant_2_role,
    true,
    v_actor,
    v_actor,
    now()
  )
  on conflict (series_key) do update
  set
    primary_coach_user_id = excluded.primary_coach_user_id,
    primary_coach_name_snapshot = excluded.primary_coach_name_snapshot,
    primary_coach_role_snapshot = excluded.primary_coach_role_snapshot,
    assistant_coach_1_user_id = excluded.assistant_coach_1_user_id,
    assistant_coach_1_name_snapshot = excluded.assistant_coach_1_name_snapshot,
    assistant_coach_1_role_snapshot = excluded.assistant_coach_1_role_snapshot,
    assistant_coach_2_user_id = excluded.assistant_coach_2_user_id,
    assistant_coach_2_name_snapshot = excluded.assistant_coach_2_name_snapshot,
    assistant_coach_2_role_snapshot = excluded.assistant_coach_2_role_snapshot,
    is_active = true,
    updated_by = excluded.updated_by,
    updated_at = now();

  v_sync := public.sync_schedule_series_coaching_team_internal(v_series_key, v_actor);

  return jsonb_build_object(
    'ok', true,
    'series_key', v_series_key,
    'primary_coach_user_id', p_primary_user_id,
    'assistant_count', cardinality(v_assistants),
    'sync', v_sync
  );
end;
$$;

revoke all on function public.set_schedule_series_coaching_team(text, uuid, uuid[]) from public;
grant execute on function public.set_schedule_series_coaching_team(text, uuid, uuid[]) to authenticated;

-- New dated sessions inherit the recurring-series team after any automatic
-- Training Program mapping. The trigger name intentionally sorts after the
-- existing auto_apply_training_program_after_session_insert trigger.
create or replace function public.zz_apply_schedule_series_coaching_team_after_session_insert_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.status = 'scheduled' then
    perform public.apply_schedule_series_coaching_team_to_session_internal(
      new.id,
      new.series_key_snapshot,
      new.generated_by
    );
  end if;
  return new;
end;
$$;

revoke all on function public.zz_apply_schedule_series_coaching_team_after_session_insert_trigger() from public;
revoke all on function public.zz_apply_schedule_series_coaching_team_after_session_insert_trigger() from authenticated;

drop trigger if exists zz_apply_schedule_series_team_after_session_insert
  on public.schedule_training_sessions;
create trigger zz_apply_schedule_series_team_after_session_insert
after insert on public.schedule_training_sessions
for each row execute function public.zz_apply_schedule_series_coaching_team_after_session_insert_trigger();

-- Manual Training Program linking must no longer overwrite the recurring class
-- default coaching team. If no schedule default / explicit override exists, the
-- Training Program team remains the fallback exactly as before.
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
  v_session_series text;
  v_program_title text;
  v_program_group text;
  v_program_start date;
  v_program_end date;
  v_program_status text;
  v_program_responsible uuid;
  v_current_id uuid;
  v_current_program_id uuid;
  v_has_log boolean := false;
  v_has_non_program_staff boolean := false;
  v_team_inherited boolean := false;
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

  select s.session_date, s.status, s.series_key_snapshot
    into v_session_date, v_session_status, v_session_series
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

    perform public.apply_schedule_series_coaching_team_to_session_internal(
      p_session_id,
      v_session_series,
      v_actor
    );

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
    'session_id', p_session_id,
    'program_id', p_program_id,
    'changed', true,
    'team_inherited', v_team_inherited,
    'existing_schedule_or_override_team_preserved', v_has_non_program_staff
  );
end;
$$;

revoke all on function public.set_schedule_session_training_program(uuid, uuid) from public;
grant execute on function public.set_schedule_session_training_program(uuid, uuid) to authenticated;

comment on table public.schedule_series_coaching_teams is
  'Default coaching team by recurring schedule series. Future dated sessions inherit this team unless a deliberate session-level override exists.';
comment on column public.schedule_session_coach_assignments.assignment_source is
  'manual = manager session override, program = technical Training Program inheritance, session_override = Responsible Coach assistant override, schedule_default = recurring schedule-series coaching team.';
comment on function public.set_schedule_series_coaching_team(text, uuid, uuid[]) is
  'Head Coach / Super Admin set one Primary Coach and up to two Assistants for a recurring schedule series. Future eligible sessions are synchronized automatically.';

commit;
