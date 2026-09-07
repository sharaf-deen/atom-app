-- Structured Schedule Lot 2F — Training Program / Training Log → Scheduled Session Linking
-- Links the planned coaching program and the actual training log to the same real dated session.
-- Existing historical/manual training logs remain valid with a null training_session_id.

begin;

create table if not exists public.schedule_session_training_program_assignments (
  id uuid primary key default gen_random_uuid(),
  training_session_id uuid not null references public.schedule_training_sessions(id) on delete restrict,
  program_id uuid not null references public.coach_training_programs(id) on delete restrict,

  program_title_snapshot text not null,
  target_group_snapshot text not null,
  program_start_date_snapshot date not null,
  program_end_date_snapshot date not null,

  is_active boolean not null default true,
  assigned_by uuid null references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  removed_by uuid null references auth.users(id) on delete set null,
  removed_at timestamptz null,
  updated_at timestamptz not null default now(),

  constraint schedule_session_training_program_name_length
    check (char_length(btrim(program_title_snapshot)) between 2 and 160),
  constraint schedule_session_training_program_group_length
    check (char_length(btrim(target_group_snapshot)) between 2 and 180),
  constraint schedule_session_training_program_dates_check
    check (program_end_date_snapshot >= program_start_date_snapshot),
  constraint schedule_session_training_program_removed_state_check
    check (
      (is_active and removed_at is null)
      or
      ((not is_active) and removed_at is not null)
    )
);

create unique index if not exists schedule_session_training_program_one_active_uq
  on public.schedule_session_training_program_assignments (training_session_id)
  where is_active;

create index if not exists schedule_session_training_program_program_idx
  on public.schedule_session_training_program_assignments (program_id, is_active, training_session_id);

alter table public.schedule_session_training_program_assignments enable row level security;

grant select on public.schedule_session_training_program_assignments to authenticated;
revoke insert, update, delete on public.schedule_session_training_program_assignments from authenticated;

drop policy if exists schedule_session_training_program_read_coaching_staff
  on public.schedule_session_training_program_assignments;
create policy schedule_session_training_program_read_coaching_staff
on public.schedule_session_training_program_assignments
for select to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role::text = any (array['assistant_coach','coach','head_coach','super_admin']::text[])
  )
);

alter table public.coach_training_session_logs
  add column if not exists training_session_id uuid null,
  add column if not exists session_assignment_role_snapshot text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'coach_training_session_logs_training_session_fk'
      and conrelid = 'public.coach_training_session_logs'::regclass
  ) then
    alter table public.coach_training_session_logs
      add constraint coach_training_session_logs_training_session_fk
      foreign key (training_session_id)
      references public.schedule_training_sessions(id)
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'coach_training_session_logs_assignment_role_check'
      and conrelid = 'public.coach_training_session_logs'::regclass
  ) then
    alter table public.coach_training_session_logs
      add constraint coach_training_session_logs_assignment_role_check
      check (
        (training_session_id is null and session_assignment_role_snapshot is null)
        or
        (
          training_session_id is not null
          and session_assignment_role_snapshot in ('primary_coach','assistant_coach')
        )
      );
  end if;
end
$$;

create unique index if not exists coach_training_session_logs_training_session_uq
  on public.coach_training_session_logs (training_session_id)
  where training_session_id is not null;

create index if not exists coach_training_session_logs_training_session_idx
  on public.coach_training_session_logs (training_session_id, status, training_date desc)
  where training_session_id is not null;

-- Keep legacy/manual logs possible, but a linked log must be created by staff actively
-- assigned to that dated session. Managers still retain their existing ability to edit logs.
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
      from public.schedule_session_coach_assignments a
      where a.training_session_id = coach_training_session_logs.training_session_id
        and a.staff_user_id = auth.uid()
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
                and a.is_active
            )
          )
        )
      )
  )
);

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

    return jsonb_build_object('ok', true, 'session_id', p_session_id, 'program_id', null, 'changed', true);
  end if;

  if v_current_program_id = p_program_id then
    return jsonb_build_object('ok', true, 'session_id', p_session_id, 'program_id', p_program_id, 'changed', false);
  end if;

  if v_has_log then
    raise exception 'SESSION_HAS_TRAINING_LOG';
  end if;

  select pr.title, pr.target_group, pr.start_date, pr.end_date, pr.status
    into v_program_title, v_program_group, v_program_start, v_program_end, v_program_status
  from public.coach_training_programs pr
  where pr.id = p_program_id;

  if not found or v_program_status <> 'published' then
    raise exception 'PUBLISHED_PROGRAM_NOT_FOUND';
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

  return jsonb_build_object('ok', true, 'session_id', p_session_id, 'program_id', p_program_id, 'changed', true);
end;
$$;

revoke all on function public.set_schedule_session_training_program(uuid, uuid) from public;
grant execute on function public.set_schedule_session_training_program(uuid, uuid) to authenticated;

comment on table public.schedule_session_training_program_assignments is
  'Structured Schedule: auditable Training Program assignment for a real dated training session. One active program per session.';

comment on column public.coach_training_session_logs.training_session_id is
  'Structured Schedule dated session represented by this actual coaching log. Null preserves legacy/manual historical logs.';

comment on column public.coach_training_session_logs.session_assignment_role_snapshot is
  'Primary/assistant assignment role held by the reporting coach when the dated-session log link was created.';

comment on function public.set_schedule_session_training_program(uuid, uuid) is
  'Head Coach/Super Admin only. Assigns or clears one published Training Program for a scheduled dated session while preserving assignment history.';

commit;
