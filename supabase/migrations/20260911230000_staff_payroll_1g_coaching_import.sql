-- Staff Payroll 1G — Automatic Coaching Import
-- Safe Schedule/Coach Operations -> Monthly Tasks bridge.
-- Governance:
--   * Admin / Super Admin can read.
--   * Super Admin only can configure mappings, manually confirm evidence and import.
--   * A coach assignment alone is never sufficient evidence for payroll import.
--   * Accepted evidence: matched staff QR, completed linked Training Log, or audited manual confirmation.
--   * Imported coaching is aggregated into one schedule-sourced monthly task row per staff/task.
--   * Existing manual/adjustment rows are never overwritten.
--   * Approved payroll months remain locked by the existing 1D protections.

begin;

create table if not exists public.staff_payroll_coaching_template_mappings (
  id uuid primary key default gen_random_uuid(),
  class_template_id uuid not null
    references public.schedule_class_templates(id) on delete restrict,
  payroll_task_id uuid not null
    references public.staff_tasks(id) on delete restrict,
  default_duration_hours numeric(6,2) null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.profiles(user_id) on delete set null,
  constraint staff_payroll_coaching_mapping_duration_chk
    check (default_duration_hours is null or (default_duration_hours > 0 and default_duration_hours <= 12))
);

create unique index if not exists staff_payroll_coaching_template_mapping_template_uq
  on public.staff_payroll_coaching_template_mappings(class_template_id);
create index if not exists staff_payroll_coaching_template_mapping_task_idx
  on public.staff_payroll_coaching_template_mappings(payroll_task_id, is_active);

create table if not exists public.staff_payroll_coaching_confirmations (
  id uuid primary key default gen_random_uuid(),
  month_start date not null,
  training_session_id uuid not null
    references public.schedule_training_sessions(id) on delete restrict,
  staff_user_id uuid not null
    references public.profiles(user_id) on delete restrict,
  reason text not null,
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid not null
    references public.profiles(user_id) on delete restrict,
  revoked_at timestamptz null,
  revoked_by uuid null
    references public.profiles(user_id) on delete set null,
  revoke_reason text null,
  constraint staff_payroll_coaching_confirmation_month_chk
    check (month_start = date_trunc('month', month_start)::date),
  constraint staff_payroll_coaching_confirmation_reason_chk
    check (char_length(btrim(reason)) between 3 and 500),
  constraint staff_payroll_coaching_confirmation_revoke_chk
    check (
      (revoked_at is null and revoked_by is null and revoke_reason is null)
      or
      (
        revoked_at is not null
        and revoked_by is not null
        and nullif(btrim(coalesce(revoke_reason, '')), '') is not null
        and char_length(revoke_reason) <= 500
      )
    )
);

create unique index if not exists staff_payroll_coaching_confirmation_active_uq
  on public.staff_payroll_coaching_confirmations(training_session_id, staff_user_id)
  where revoked_at is null;
create index if not exists staff_payroll_coaching_confirmation_month_idx
  on public.staff_payroll_coaching_confirmations(month_start, staff_user_id, confirmed_at desc);

create table if not exists public.staff_payroll_coaching_import_items (
  id uuid primary key default gen_random_uuid(),
  month_start date not null,
  training_session_id uuid not null
    references public.schedule_training_sessions(id) on delete restrict,
  class_template_id uuid not null
    references public.schedule_class_templates(id) on delete restrict,
  staff_user_id uuid not null
    references public.profiles(user_id) on delete restrict,
  payroll_task_id uuid not null
    references public.staff_tasks(id) on delete restrict,
  monthly_task_log_id uuid not null
    references public.staff_monthly_task_logs(id) on delete restrict,

  session_date_snapshot date not null,
  session_name_snapshot text not null,
  session_start_time_snapshot time without time zone not null,
  session_end_time_snapshot time without time zone null,
  staff_name_snapshot text not null,
  assignment_role_snapshot text not null,
  task_name_snapshot text not null,
  evidence_type text not null,
  qr_attendance_id uuid null references public.coach_staff_attendance(id) on delete restrict,
  training_log_id uuid null references public.coach_training_session_logs(id) on delete restrict,
  manual_confirmation_id uuid null references public.staff_payroll_coaching_confirmations(id) on delete restrict,
  duration_hours numeric(6,2) not null,
  duration_source text not null,

  status text not null default 'active',
  imported_at timestamptz not null default now(),
  imported_by uuid not null references public.profiles(user_id) on delete restrict,
  released_at timestamptz null,
  released_by uuid null references public.profiles(user_id) on delete set null,
  release_reason text null,

  constraint staff_payroll_coaching_import_month_chk
    check (month_start = date_trunc('month', month_start)::date),
  constraint staff_payroll_coaching_import_assignment_role_chk
    check (assignment_role_snapshot in ('primary_coach','assistant_coach')),
  constraint staff_payroll_coaching_import_evidence_chk
    check (evidence_type in ('qr','completed_log','qr_and_completed_log','manual_confirmation')),
  constraint staff_payroll_coaching_import_evidence_refs_chk
    check (
      (evidence_type = 'qr' and qr_attendance_id is not null and training_log_id is null and manual_confirmation_id is null)
      or
      (evidence_type = 'completed_log' and qr_attendance_id is null and training_log_id is not null and manual_confirmation_id is null)
      or
      (evidence_type = 'qr_and_completed_log' and qr_attendance_id is not null and training_log_id is not null and manual_confirmation_id is null)
      or
      (evidence_type = 'manual_confirmation' and qr_attendance_id is null and training_log_id is null and manual_confirmation_id is not null)
    ),
  constraint staff_payroll_coaching_import_duration_chk
    check (duration_hours > 0 and duration_hours <= 12),
  constraint staff_payroll_coaching_import_duration_source_chk
    check (duration_source in ('session_end','mapping_default','override')),
  constraint staff_payroll_coaching_import_status_chk
    check (status in ('active','released')),
  constraint staff_payroll_coaching_import_release_chk
    check (
      (status = 'active' and released_at is null and released_by is null and release_reason is null)
      or
      (
        status = 'released'
        and released_at is not null
        and nullif(btrim(coalesce(release_reason, '')), '') is not null
        and char_length(release_reason) <= 500
      )
    )
);

create unique index if not exists staff_payroll_coaching_import_active_session_staff_uq
  on public.staff_payroll_coaching_import_items(training_session_id, staff_user_id)
  where status = 'active';
create index if not exists staff_payroll_coaching_import_month_staff_idx
  on public.staff_payroll_coaching_import_items(month_start, staff_user_id, payroll_task_id, status);
create index if not exists staff_payroll_coaching_import_log_idx
  on public.staff_payroll_coaching_import_items(monthly_task_log_id, status);

create or replace function public.staff_payroll_coaching_mapping_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists staff_payroll_coaching_mapping_touch_updated_at
  on public.staff_payroll_coaching_template_mappings;
create trigger staff_payroll_coaching_mapping_touch_updated_at
before update on public.staff_payroll_coaching_template_mappings
for each row execute function public.staff_payroll_coaching_mapping_touch_updated_at();

-- When an imported schedule row is manually voided, release the session-level import links.
-- This makes those factual sessions eligible for a clean future Generate/Review/Import cycle.
create or replace function public.staff_payroll_release_coaching_imports_on_log_void()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if old.voided_at is null and new.voided_at is not null then
    update public.staff_payroll_coaching_import_items
    set status = 'released',
        released_at = now(),
        released_by = coalesce(auth.uid(), new.voided_by),
        release_reason = coalesce(nullif(btrim(new.void_reason), ''), 'Monthly task row voided')
    where monthly_task_log_id = new.id
      and status = 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists staff_payroll_release_coaching_imports_on_log_void
  on public.staff_monthly_task_logs;
create trigger staff_payroll_release_coaching_imports_on_log_void
after update on public.staff_monthly_task_logs
for each row execute function public.staff_payroll_release_coaching_imports_on_log_void();

-- Transactional import. The API passes only reviewed session/staff rows and duration overrides;
-- the database re-validates assignment, mapping, evidence, lock state and duplicates atomically.
create or replace function public.staff_payroll_import_coaching_sessions(
  p_month_start date,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_snapshot_status text;
  v_item jsonb;
  v_session_id uuid;
  v_staff_user_id uuid;
  v_duration numeric(6,2);
  v_session record;
  v_assignment record;
  v_mapping record;
  v_task record;
  v_area_name text;
  v_staff_name text;
  v_qr_id uuid;
  v_training_log_id uuid;
  v_confirmation_id uuid;
  v_evidence text;
  v_derived_duration numeric(6,2);
  v_duration_source text;
  v_log record;
  v_import_id uuid;
  v_imported integer := 0;
  v_log_ids uuid[] := '{}'::uuid[];
begin
  if v_actor is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  select p.role::text into v_actor_role
  from public.profiles p
  where p.user_id = v_actor;

  if v_actor_role is distinct from 'super_admin' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_month_start is null or p_month_start <> date_trunc('month', p_month_start)::date then
    raise exception 'INVALID_MONTH';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'NO_IMPORT_ITEMS';
  end if;

  select s.status into v_snapshot_status
  from public.staff_payroll_monthly_snapshots s
  where s.month_start = p_month_start;

  if v_snapshot_status = 'approved' then
    raise exception 'STAFF_PAYROLL_MONTH_LOCKED';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_session_id := nullif(v_item->>'session_id', '')::uuid;
      v_staff_user_id := nullif(v_item->>'staff_user_id', '')::uuid;
      v_duration := round((v_item->>'duration_hours')::numeric, 2);
    exception when others then
      raise exception 'INVALID_IMPORT_ITEM';
    end;

    if v_session_id is null or v_staff_user_id is null or v_duration is null
       or v_duration <= 0 or v_duration > 12 then
      raise exception 'INVALID_IMPORT_ITEM';
    end if;

    select s.* into v_session
    from public.schedule_training_sessions s
    where s.id = v_session_id
      and s.session_date >= p_month_start
      and s.session_date < (p_month_start + interval '1 month')::date
      and s.status <> 'cancelled'
    for share;

    if not found then
      raise exception 'SESSION_NOT_ELIGIBLE';
    end if;

    select a.* into v_assignment
    from public.schedule_session_coach_assignments a
    where a.training_session_id = v_session_id
      and a.staff_user_id = v_staff_user_id
      and a.is_active
    limit 1;

    if not found then
      raise exception 'ACTIVE_ASSIGNMENT_REQUIRED';
    end if;

    select m.*, t.id as task_exists into v_mapping
    from public.staff_payroll_coaching_template_mappings m
    join public.staff_tasks t on t.id = m.payroll_task_id
    where m.class_template_id = v_session.class_template_id
      and m.is_active
      and t.is_active
      and t.unit = 'class'
    limit 1;

    if not found then
      raise exception 'PAYROLL_MAPPING_REQUIRED';
    end if;

    select t.id, t.area_id, t.name, t.unit, t.importance_level, t.importance_multiplier
      into v_task
    from public.staff_tasks t
    where t.id = v_mapping.payroll_task_id
      and t.is_active
      and t.unit = 'class';

    if not found then
      raise exception 'PAYROLL_TASK_NOT_ELIGIBLE';
    end if;

    select a.name into v_area_name
    from public.staff_task_areas a
    where a.id = v_task.area_id;

    if v_area_name is null then
      raise exception 'PAYROLL_TASK_AREA_NOT_FOUND';
    end if;

    select coalesce(
      nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
      nullif(btrim(p.email), ''),
      left(p.user_id::text, 8)
    ) into v_staff_name
    from public.profiles p
    where p.user_id = v_staff_user_id;

    if v_staff_name is null then
      v_staff_name := v_assignment.staff_name_snapshot;
    end if;

    select q.id into v_qr_id
    from public.coach_staff_attendance q
    where q.training_session_id = v_session_id
      and q.staff_user_id = v_staff_user_id
      and q.session_match_status = 'matched'
    order by q.checked_in_at asc
    limit 1;

    select l.id into v_training_log_id
    from public.coach_training_session_logs l
    where l.training_session_id = v_session_id
      and l.coach_user_id = v_staff_user_id
      and l.status = 'completed'
    order by l.completed_at asc nulls last, l.created_at asc
    limit 1;

    select c.id into v_confirmation_id
    from public.staff_payroll_coaching_confirmations c
    where c.training_session_id = v_session_id
      and c.staff_user_id = v_staff_user_id
      and c.month_start = p_month_start
      and c.revoked_at is null
    order by c.confirmed_at desc
    limit 1;

    if v_qr_id is not null and v_training_log_id is not null then
      v_evidence := 'qr_and_completed_log';
      v_confirmation_id := null;
    elsif v_qr_id is not null then
      v_evidence := 'qr';
      v_training_log_id := null;
      v_confirmation_id := null;
    elsif v_training_log_id is not null then
      v_evidence := 'completed_log';
      v_qr_id := null;
      v_confirmation_id := null;
    elsif v_confirmation_id is not null then
      v_evidence := 'manual_confirmation';
      v_qr_id := null;
      v_training_log_id := null;
    else
      raise exception 'COACHING_EVIDENCE_REQUIRED';
    end if;

    if exists (
      select 1 from public.staff_payroll_coaching_import_items i
      where i.training_session_id = v_session_id
        and i.staff_user_id = v_staff_user_id
        and i.status = 'active'
    ) then
      raise exception 'COACHING_SESSION_ALREADY_IMPORTED';
    end if;

    if v_session.end_time is not null then
      v_derived_duration := round((extract(epoch from (v_session.end_time - v_session.start_time)) / 3600.0)::numeric, 2);
      v_duration_source := 'session_end';
    elsif v_mapping.default_duration_hours is not null then
      v_derived_duration := round(v_mapping.default_duration_hours::numeric, 2);
      v_duration_source := 'mapping_default';
    else
      v_derived_duration := null;
      v_duration_source := 'override';
    end if;

    if v_derived_duration is null or abs(v_duration - v_derived_duration) > 0.01 then
      v_duration_source := 'override';
    end if;

    select l.* into v_log
    from public.staff_monthly_task_logs l
    where l.month_start = p_month_start
      and l.staff_user_id = v_staff_user_id
      and l.task_id = v_task.id
      and l.voided_at is null
    for update;

    if found and v_log.source <> 'schedule' then
      raise exception 'MANUAL_MONTHLY_TASK_CONFLICT';
    end if;

    if not found then
      insert into public.staff_monthly_task_logs (
        month_start,
        staff_user_id,
        task_id,
        area_id_snapshot,
        task_name_snapshot,
        area_name_snapshot,
        unit_snapshot,
        importance_level_snapshot,
        importance_multiplier_snapshot,
        work_quantity,
        actual_hours,
        note,
        source,
        created_by,
        updated_by
      ) values (
        p_month_start,
        v_staff_user_id,
        v_task.id,
        v_task.area_id,
        v_task.name,
        v_area_name,
        v_task.unit,
        v_task.importance_level,
        v_task.importance_multiplier,
        1,
        v_duration,
        'Generated from confirmed Structured Schedule coaching sessions.',
        'schedule',
        v_actor,
        v_actor
      )
      returning * into v_log;
    end if;

    insert into public.staff_payroll_coaching_import_items (
      month_start,
      training_session_id,
      class_template_id,
      staff_user_id,
      payroll_task_id,
      monthly_task_log_id,
      session_date_snapshot,
      session_name_snapshot,
      session_start_time_snapshot,
      session_end_time_snapshot,
      staff_name_snapshot,
      assignment_role_snapshot,
      task_name_snapshot,
      evidence_type,
      qr_attendance_id,
      training_log_id,
      manual_confirmation_id,
      duration_hours,
      duration_source,
      imported_by
    ) values (
      p_month_start,
      v_session_id,
      v_session.class_template_id,
      v_staff_user_id,
      v_task.id,
      v_log.id,
      v_session.session_date,
      v_session.name_snapshot,
      v_session.start_time,
      v_session.end_time,
      v_staff_name,
      v_assignment.assignment_role,
      v_task.name,
      v_evidence,
      v_qr_id,
      v_training_log_id,
      v_confirmation_id,
      v_duration,
      v_duration_source,
      v_actor
    )
    returning id into v_import_id;

    update public.staff_monthly_task_logs l
    set work_quantity = x.qty,
        actual_hours = x.hours,
        note = 'Schedule import · ' || x.qty::text || ' confirmed coaching session' || case when x.qty = 1 then '' else 's' end || '.',
        source = 'schedule',
        updated_by = v_actor
    from (
      select count(*)::numeric as qty, round(sum(i.duration_hours), 2) as hours
      from public.staff_payroll_coaching_import_items i
      where i.monthly_task_log_id = v_log.id
        and i.status = 'active'
    ) x
    where l.id = v_log.id;

    v_imported := v_imported + 1;
    if not (v_log.id = any(v_log_ids)) then
      v_log_ids := array_append(v_log_ids, v_log.id);
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'imported_count', v_imported,
    'monthly_task_log_ids', to_jsonb(v_log_ids)
  );
end;
$$;

revoke all on function public.staff_payroll_import_coaching_sessions(date, jsonb) from public;
grant execute on function public.staff_payroll_import_coaching_sessions(date, jsonb) to authenticated;

alter table public.staff_payroll_coaching_template_mappings enable row level security;
alter table public.staff_payroll_coaching_confirmations enable row level security;
alter table public.staff_payroll_coaching_import_items enable row level security;

-- Admin is explicitly read-only throughout Staff Payroll.
drop policy if exists "admin read coaching payroll mappings" on public.staff_payroll_coaching_template_mappings;
create policy "admin read coaching payroll mappings"
  on public.staff_payroll_coaching_template_mappings for select
  using (public.is_admin_or_super_admin(auth.uid()));

drop policy if exists "super admin write coaching payroll mappings" on public.staff_payroll_coaching_template_mappings;
create policy "super admin write coaching payroll mappings"
  on public.staff_payroll_coaching_template_mappings for all
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

drop policy if exists "admin read coaching payroll confirmations" on public.staff_payroll_coaching_confirmations;
create policy "admin read coaching payroll confirmations"
  on public.staff_payroll_coaching_confirmations for select
  using (public.is_admin_or_super_admin(auth.uid()));

drop policy if exists "super admin write coaching payroll confirmations" on public.staff_payroll_coaching_confirmations;
create policy "super admin write coaching payroll confirmations"
  on public.staff_payroll_coaching_confirmations for all
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

drop policy if exists "admin read coaching payroll import items" on public.staff_payroll_coaching_import_items;
create policy "admin read coaching payroll import items"
  on public.staff_payroll_coaching_import_items for select
  using (public.is_admin_or_super_admin(auth.uid()));

-- Import items are created by the audited RPC. No direct authenticated write grant.
revoke all on table public.staff_payroll_coaching_template_mappings from authenticated;
grant select, insert, update on table public.staff_payroll_coaching_template_mappings to authenticated;
revoke delete on table public.staff_payroll_coaching_template_mappings from authenticated;

revoke all on table public.staff_payroll_coaching_confirmations from authenticated;
grant select, insert, update on table public.staff_payroll_coaching_confirmations to authenticated;
revoke delete on table public.staff_payroll_coaching_confirmations from authenticated;

revoke all on table public.staff_payroll_coaching_import_items from authenticated;
grant select on table public.staff_payroll_coaching_import_items to authenticated;

grant all on table public.staff_payroll_coaching_template_mappings to service_role;
grant all on table public.staff_payroll_coaching_confirmations to service_role;
grant all on table public.staff_payroll_coaching_import_items to service_role;

comment on table public.staff_payroll_coaching_template_mappings is
  'Staff Payroll 1G mapping from a Structured Schedule class template to one active class-based payroll task, with optional fallback duration.';
comment on table public.staff_payroll_coaching_confirmations is
  'Audited Super Admin manual confirmation used only when linked QR/completed-log evidence is absent.';
comment on table public.staff_payroll_coaching_import_items is
  'Immutable session-level audit trail behind schedule-sourced monthly coaching task aggregation.';
comment on function public.staff_payroll_import_coaching_sessions(date, jsonb) is
  'Super Admin only transactional Generate/Review/Import finalization. Re-validates assignment, mapping, evidence, duplicates and payroll lock before aggregating into Monthly Tasks.';

commit;
