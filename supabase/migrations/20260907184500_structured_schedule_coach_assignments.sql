-- Structured Schedule Lot 2D — Coach Assignment
-- Adds auditable coaching-staff assignments to real dated training sessions.
-- Assignments are internal only and are not exposed by the member Schedule RPC.
-- A dated session with active staff assignments is protected from Lot 2B template sync
-- so a recurring-template change cannot silently move/delete an operationally staffed session.

begin;

create table if not exists public.schedule_session_coach_assignments (
  id uuid primary key default gen_random_uuid(),
  training_session_id uuid not null references public.schedule_training_sessions(id) on delete restrict,
  staff_user_id uuid not null references auth.users(id) on delete restrict,
  assignment_role text not null,
  staff_name_snapshot text not null,
  staff_profile_role_snapshot text not null,
  is_active boolean not null default true,

  assigned_by uuid null references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  removed_by uuid null references auth.users(id) on delete set null,
  removed_at timestamptz null,
  updated_at timestamptz not null default now(),

  constraint schedule_session_coach_assignments_role_check
    check (assignment_role in ('primary_coach','assistant_coach')),
  constraint schedule_session_coach_assignments_profile_role_check
    check (staff_profile_role_snapshot in ('assistant_coach','coach','head_coach','super_admin')),
  constraint schedule_session_coach_assignments_name_length
    check (char_length(btrim(staff_name_snapshot)) between 1 and 180),
  constraint schedule_session_coach_assignments_removed_state_check
    check (
      (is_active and removed_at is null)
      or
      ((not is_active) and removed_at is not null)
    )
);

create unique index if not exists schedule_session_coach_assignments_one_active_primary_uq
  on public.schedule_session_coach_assignments (training_session_id)
  where is_active and assignment_role = 'primary_coach';

create unique index if not exists schedule_session_coach_assignments_active_staff_uq
  on public.schedule_session_coach_assignments (training_session_id, staff_user_id)
  where is_active;

create index if not exists schedule_session_coach_assignments_staff_idx
  on public.schedule_session_coach_assignments (staff_user_id, is_active, training_session_id);

create index if not exists schedule_session_coach_assignments_session_idx
  on public.schedule_session_coach_assignments (training_session_id, is_active, assignment_role);

alter table public.schedule_session_coach_assignments enable row level security;

grant select on public.schedule_session_coach_assignments to authenticated;
revoke insert, update, delete on public.schedule_session_coach_assignments from authenticated;

drop policy if exists schedule_session_coach_assignments_read_coaching_staff
  on public.schedule_session_coach_assignments;

create policy schedule_session_coach_assignments_read_coaching_staff
on public.schedule_session_coach_assignments
for select to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role::text = any (
        array['assistant_coach','coach','head_coach','super_admin']::text[]
      )
  )
);

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
  v_session_status text;
  v_assistants uuid[] := '{}'::uuid[];
  v_staff_user_id uuid;
  v_staff_name text;
  v_staff_role text;
  v_removed integer := 0;
  v_added integer := 0;
  v_active integer := 0;
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

  select coalesce(array_agg(distinct x), '{}'::uuid[])
    into v_assistants
  from unnest(coalesce(p_assistant_user_ids, '{}'::uuid[])) as x
  where x is not null
    and (p_primary_user_id is null or x <> p_primary_user_id);

  if cardinality(v_assistants) > 6 then
    raise exception 'TOO_MANY_ASSISTANTS';
  end if;

  if p_primary_user_id is null and cardinality(v_assistants) > 0 then
    raise exception 'PRIMARY_COACH_REQUIRED';
  end if;

  if p_primary_user_id is not null then
    select
      coalesce(
        nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
        nullif(btrim(p.email), ''),
        'Staff'
      ),
      p.role::text
      into v_staff_name, v_staff_role
    from public.profiles p
    where p.user_id = p_primary_user_id;

    if not found
       or v_staff_role <> all (
         array['assistant_coach','coach','head_coach','super_admin']::text[]
       ) then
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
       or v_staff_role <> all (
         array['assistant_coach','coach','head_coach','super_admin']::text[]
       ) then
      raise exception 'INVALID_ASSISTANT_COACH';
    end if;
  end loop;

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
        and p_primary_user_id is not null
        and a.staff_user_id = p_primary_user_id
      )
      or
      (
        a.assignment_role = 'assistant_coach'
        and a.staff_user_id = any (v_assistants)
      )
    );

  get diagnostics v_removed = row_count;

  if p_primary_user_id is not null
     and not exists (
       select 1
       from public.schedule_session_coach_assignments a
       where a.training_session_id = p_session_id
         and a.staff_user_id = p_primary_user_id
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
    where p.user_id = p_primary_user_id;

    insert into public.schedule_session_coach_assignments (
      training_session_id,
      staff_user_id,
      assignment_role,
      staff_name_snapshot,
      staff_profile_role_snapshot,
      assigned_by
    )
    values (
      p_session_id,
      p_primary_user_id,
      'primary_coach',
      v_staff_name,
      v_staff_role,
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
        assigned_by
      )
      values (
        p_session_id,
        v_staff_user_id,
        'assistant_coach',
        v_staff_name,
        v_staff_role,
        v_actor
      );

      v_added := v_added + 1;
    end if;
  end loop;

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
    'active', v_active
  );
end;
$$;

revoke all on function public.set_schedule_session_coach_assignments(uuid, uuid, uuid[]) from public;
grant execute on function public.set_schedule_session_coach_assignments(uuid, uuid, uuid[]) to authenticated;

comment on table public.schedule_session_coach_assignments is
  'Structured Schedule: auditable primary/assistant coaching assignments for real dated training sessions.';

comment on function public.set_schedule_session_coach_assignments(uuid, uuid, uuid[]) is
  'Head Coach/Super Admin only. Reconciles active staff assignments for a scheduled dated session without physically deleting assignment history.';

commit;
