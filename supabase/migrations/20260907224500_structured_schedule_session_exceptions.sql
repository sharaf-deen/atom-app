-- Structured Schedule Lot 2G — Schedule Exceptions / Cancellations / Coach Replacement
-- Adds auditable one-off changes to real dated sessions without modifying the recurring Class Template.
-- Member Schedule already reads live dated-session time/mat/status, so approved exceptions surface automatically.

begin;

create table if not exists public.schedule_session_exception_events (
  id uuid primary key default gen_random_uuid(),
  training_session_id uuid not null references public.schedule_training_sessions(id) on delete restrict,
  event_type text not null,
  reason text not null,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  changed_by uuid null references auth.users(id) on delete set null,
  actor_name_snapshot text not null,
  actor_role_snapshot text not null,
  changed_at timestamptz not null default now(),
  constraint schedule_session_exception_events_type_check
    check (event_type in ('details_changed','cancelled','restored','staff_replaced')),
  constraint schedule_session_exception_events_reason_length
    check (char_length(btrim(reason)) between 3 and 1000),
  constraint schedule_session_exception_events_actor_name_length
    check (char_length(btrim(actor_name_snapshot)) between 1 and 180),
  constraint schedule_session_exception_events_actor_role_check
    check (actor_role_snapshot in ('head_coach','super_admin'))
);

create index if not exists schedule_session_exception_events_session_idx
  on public.schedule_session_exception_events (training_session_id, changed_at desc);

create index if not exists schedule_session_exception_events_type_idx
  on public.schedule_session_exception_events (event_type, changed_at desc);

alter table public.schedule_session_exception_events enable row level security;

grant select on public.schedule_session_exception_events to authenticated;
revoke insert, update, delete on public.schedule_session_exception_events from authenticated;

drop policy if exists schedule_session_exception_events_read_managers
  on public.schedule_session_exception_events;
create policy schedule_session_exception_events_read_managers
on public.schedule_session_exception_events
for select to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role::text = any (array['head_coach','super_admin']::text[])
  )
);

create or replace function public.apply_schedule_session_exception(
  p_session_id uuid,
  p_operation text,
  p_reason text,
  p_start_time time without time zone default null,
  p_end_time time without time zone default null,
  p_mat text default null,
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
  v_actor_name text;
  v_session public.schedule_training_sessions%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_operation text := lower(btrim(coalesce(p_operation, '')));
  v_mat text := nullif(btrim(coalesce(p_mat, '')), '');
  v_has_attendance boolean := false;
  v_has_log boolean := false;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_before_assignments jsonb := '[]'::jsonb;
  v_after_assignments jsonb := '[]'::jsonb;
  v_assignment_result jsonb;
  v_event_type text;
  v_event_id uuid;
begin
  if v_actor is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  select
    p.role::text,
    coalesce(
      nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
      nullif(btrim(p.email), ''),
      'Staff'
    )
  into v_actor_role, v_actor_name
  from public.profiles p
  where p.user_id = v_actor;

  if v_actor_role is null
     or v_actor_role <> all (array['head_coach','super_admin']::text[]) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if char_length(v_reason) < 3 or char_length(v_reason) > 1000 then
    raise exception 'INVALID_REASON';
  end if;

  select s.*
  into v_session
  from public.schedule_training_sessions s
  where s.id = p_session_id
  for update;

  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;

  select exists (
    select 1
    from public.coach_staff_attendance a
    where a.training_session_id = p_session_id
  ) into v_has_attendance;

  select exists (
    select 1
    from public.coach_training_session_logs l
    where l.training_session_id = p_session_id
  ) into v_has_log;

  v_before := jsonb_build_object(
    'status', v_session.status,
    'start_time', to_char(v_session.start_time, 'HH24:MI'),
    'end_time', case when v_session.end_time is null then null else to_char(v_session.end_time, 'HH24:MI') end,
    'mat', v_session.mat_snapshot,
    'template_managed', v_session.template_managed
  );

  if v_operation = 'details' then
    if v_session.status <> 'scheduled' then
      raise exception 'SESSION_NOT_SCHEDULED';
    end if;

    if p_start_time is null then
      raise exception 'INVALID_START_TIME';
    end if;

    if p_end_time is not null and p_end_time <= p_start_time then
      raise exception 'INVALID_END_TIME';
    end if;

    if v_mat is not null and char_length(v_mat) > 80 then
      raise exception 'INVALID_MAT';
    end if;

    -- Once real operational history exists, changing planned time/mat would make the
    -- stored QR timing or Training Log context misleading. Cancellation remains a
    -- separate auditable action, but details are locked.
    if v_has_attendance or v_has_log then
      raise exception 'SESSION_HAS_OPERATIONAL_HISTORY';
    end if;

    if v_session.start_time = p_start_time
       and v_session.end_time is not distinct from p_end_time
       and v_session.mat_snapshot is not distinct from v_mat
       and v_session.template_managed = false then
      return jsonb_build_object('ok', true, 'changed', false, 'session_id', p_session_id);
    end if;

    update public.schedule_training_sessions
    set start_time = p_start_time,
        end_time = p_end_time,
        mat_snapshot = v_mat,
        template_managed = false,
        updated_at = now()
    where id = p_session_id;

    v_event_type := 'details_changed';

  elsif v_operation = 'cancel' then
    if v_session.status <> 'scheduled' then
      raise exception 'SESSION_NOT_SCHEDULED';
    end if;

    -- A linked Training Log represents actual teaching history; such a session cannot
    -- later be declared cancelled. QR attendance alone does not prevent a genuine
    -- same-day cancellation after staff arrival.
    if v_has_log then
      raise exception 'SESSION_HAS_TRAINING_LOG';
    end if;

    update public.schedule_training_sessions
    set status = 'cancelled',
        template_managed = false,
        updated_at = now()
    where id = p_session_id;

    v_event_type := 'cancelled';

  elsif v_operation = 'restore' then
    if v_session.status <> 'cancelled' then
      raise exception 'SESSION_NOT_CANCELLED';
    end if;

    update public.schedule_training_sessions
    set status = 'scheduled',
        template_managed = false,
        updated_at = now()
    where id = p_session_id;

    v_event_type := 'restored';

  elsif v_operation = 'replace_staff' then
    if v_session.status <> 'scheduled' then
      raise exception 'SESSION_NOT_SCHEDULED';
    end if;

    if p_primary_user_id is null then
      raise exception 'PRIMARY_COACH_REQUIRED';
    end if;

    -- Once an actual Training Log is linked, coach assignment history is considered
    -- operationally final for this lot. QR-only history may still be corrected through
    -- an explicitly audited replacement.
    if v_has_log then
      raise exception 'SESSION_HAS_TRAINING_LOG';
    end if;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'staff_user_id', a.staff_user_id,
          'staff_name', a.staff_name_snapshot,
          'assignment_role', a.assignment_role
        )
        order by a.assignment_role desc, a.staff_name_snapshot asc
      ),
      '[]'::jsonb
    )
    into v_before_assignments
    from public.schedule_session_coach_assignments a
    where a.training_session_id = p_session_id
      and a.is_active;

    select public.set_schedule_session_coach_assignments(
      p_session_id,
      p_primary_user_id,
      coalesce(p_assistant_user_ids, '{}'::uuid[])
    ) into v_assignment_result;

    update public.schedule_training_sessions
    set template_managed = false,
        updated_at = now()
    where id = p_session_id;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'staff_user_id', a.staff_user_id,
          'staff_name', a.staff_name_snapshot,
          'assignment_role', a.assignment_role
        )
        order by a.assignment_role desc, a.staff_name_snapshot asc
      ),
      '[]'::jsonb
    )
    into v_after_assignments
    from public.schedule_session_coach_assignments a
    where a.training_session_id = p_session_id
      and a.is_active;

    if v_before_assignments = v_after_assignments and v_session.template_managed = false then
      return jsonb_build_object('ok', true, 'changed', false, 'session_id', p_session_id);
    end if;

    v_before := v_before || jsonb_build_object('assignments', v_before_assignments);
    v_event_type := 'staff_replaced';

  else
    raise exception 'INVALID_OPERATION';
  end if;

  select jsonb_build_object(
    'status', s.status,
    'start_time', to_char(s.start_time, 'HH24:MI'),
    'end_time', case when s.end_time is null then null else to_char(s.end_time, 'HH24:MI') end,
    'mat', s.mat_snapshot,
    'template_managed', s.template_managed
  )
  into v_after
  from public.schedule_training_sessions s
  where s.id = p_session_id;

  if v_operation = 'replace_staff' then
    v_after := v_after || jsonb_build_object('assignments', v_after_assignments);
  end if;

  insert into public.schedule_session_exception_events (
    training_session_id,
    event_type,
    reason,
    before_state,
    after_state,
    changed_by,
    actor_name_snapshot,
    actor_role_snapshot
  ) values (
    p_session_id,
    v_event_type,
    v_reason,
    v_before,
    v_after,
    v_actor,
    v_actor_name,
    v_actor_role
  )
  returning id into v_event_id;

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'session_id', p_session_id,
    'event_id', v_event_id,
    'event_type', v_event_type
  );
end;
$$;

revoke all on function public.apply_schedule_session_exception(uuid, text, text, time, time, text, uuid, uuid[]) from public;
grant execute on function public.apply_schedule_session_exception(uuid, text, text, time, time, text, uuid, uuid[]) to authenticated;

comment on table public.schedule_session_exception_events is
  'Structured Schedule: immutable audit trail of one-off dated-session changes, cancellations/restores and staff replacements.';

comment on function public.apply_schedule_session_exception(uuid, text, text, time, time, text, uuid, uuid[]) is
  'Head Coach/Super Admin only. Applies an auditable one-off exception to a dated session and permanently removes that session from recurring-template sync management.';

commit;
