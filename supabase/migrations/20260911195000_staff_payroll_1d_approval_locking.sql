-- Staff Payroll 1D — Payroll Approval & Monthly Locking
-- Scope:
--   * Draft -> Approved & Locked.
--   * Approval requires a fresh 1C recalculation with no missing hours / unconfigured staff.
--   * Approved months lock monthly task logs and current calculation rows at DB level.
--   * Each approval creates an immutable version + immutable per-staff calculation copy.
--   * Exceptional reopen requires a reason, preserves the approved version, and forces recalculation.
--   * No salary payment or payslip workflow is introduced here.

begin;

alter table public.staff_payroll_monthly_snapshots
  drop constraint if exists staff_payroll_monthly_snapshots_status_chk;

alter table public.staff_payroll_monthly_snapshots
  add constraint staff_payroll_monthly_snapshots_status_chk
  check (status in ('draft','approved'));

alter table public.staff_payroll_monthly_snapshots
  add column if not exists approval_version_no integer not null default 0,
  add column if not exists approved_at timestamptz null,
  add column if not exists approved_by uuid null references public.profiles(user_id) on delete set null,
  add column if not exists last_reopened_at timestamptz null,
  add column if not exists last_reopened_by uuid null references public.profiles(user_id) on delete set null,
  add column if not exists last_reopen_reason text null,
  add column if not exists financial_source_hash text null,
  add column if not exists task_source_hash text null,
  add column if not exists compensation_source_hash text null,
  add column if not exists staff_source_hash text null,
  add column if not exists draft_snapshot_hash text null,
  add column if not exists draft_calculation_hash text null;

alter table public.staff_payroll_monthly_snapshots
  drop constraint if exists staff_payroll_monthly_snapshots_approval_version_chk;
alter table public.staff_payroll_monthly_snapshots
  add constraint staff_payroll_monthly_snapshots_approval_version_chk
  check (approval_version_no >= 0);

alter table public.staff_payroll_monthly_snapshots
  drop constraint if exists staff_payroll_monthly_snapshots_approved_state_chk;
alter table public.staff_payroll_monthly_snapshots
  add constraint staff_payroll_monthly_snapshots_approved_state_chk
  check (
    (status = 'draft')
    or
    (
      status = 'approved'
      and approval_version_no >= 1
      and approved_at is not null
      and approved_by is not null
    )
  );

alter table public.staff_payroll_monthly_snapshots
  drop constraint if exists staff_payroll_monthly_snapshots_reopen_reason_chk;
alter table public.staff_payroll_monthly_snapshots
  add constraint staff_payroll_monthly_snapshots_reopen_reason_chk
  check (
    last_reopen_reason is null
    or char_length(btrim(last_reopen_reason)) between 3 and 1000
  );

create table if not exists public.staff_payroll_approval_versions (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null
    references public.staff_payroll_monthly_snapshots(id)
    on delete restrict,
  month_start date not null,
  version_no integer not null,
  approved_at timestamptz not null,
  approved_by uuid null references public.profiles(user_id) on delete set null,
  approved_by_name_snapshot text not null,
  approval_note text null,
  calculated_payroll_total numeric(14,2) not null,
  staff_count integer not null,
  financial_source_hash text not null,
  task_source_hash text not null,
  compensation_source_hash text not null,
  staff_source_hash text not null,
  draft_snapshot_hash text not null,
  draft_calculation_hash text not null,
  snapshot_payload jsonb not null,
  created_at timestamptz not null default now(),

  constraint staff_payroll_approval_versions_month_chk
    check (month_start = date_trunc('month', month_start)::date),
  constraint staff_payroll_approval_versions_version_chk
    check (version_no >= 1),
  constraint staff_payroll_approval_versions_staff_count_chk
    check (staff_count >= 1),
  constraint staff_payroll_approval_versions_amount_chk
    check (calculated_payroll_total >= 0),
  constraint staff_payroll_approval_versions_approver_name_chk
    check (char_length(btrim(approved_by_name_snapshot)) between 1 and 200),
  constraint staff_payroll_approval_versions_note_chk
    check (approval_note is null or char_length(approval_note) <= 2000),
  unique (snapshot_id, version_no),
  unique (month_start, version_no)
);

create index if not exists staff_payroll_approval_versions_month_idx
  on public.staff_payroll_approval_versions(month_start desc, version_no desc);

create table if not exists public.staff_payroll_approval_calculations (
  id uuid primary key default gen_random_uuid(),
  approval_version_id uuid not null
    references public.staff_payroll_approval_versions(id)
    on delete restrict,
  snapshot_id uuid not null
    references public.staff_payroll_monthly_snapshots(id)
    on delete restrict,
  month_start date not null,
  staff_user_id uuid not null
    references public.profiles(user_id)
    on delete restrict,
  staff_name_snapshot text not null,
  staff_role_snapshot text null,
  compensation_configured boolean not null,
  fixed_monthly_base numeric(12,2) not null,
  weighted_hour_rate numeric(12,2) not null,
  bonus_eligible boolean not null,
  active_task_count integer not null,
  missing_hours_task_count integer not null,
  actual_hours numeric(12,2) not null,
  weighted_hours numeric(12,2) not null,
  task_compensation numeric(14,2) not null,
  guaranteed_compensation numeric(14,2) not null,
  bonus_weight_share_percent numeric(9,4) not null,
  performance_bonus numeric(14,2) not null,
  calculated_salary numeric(14,2) not null,
  created_at timestamptz not null default now(),

  unique (approval_version_id, staff_user_id),
  constraint staff_payroll_approval_calculations_month_chk
    check (month_start = date_trunc('month', month_start)::date)
);

create index if not exists staff_payroll_approval_calculations_staff_idx
  on public.staff_payroll_approval_calculations(staff_user_id, month_start desc);

create table if not exists public.staff_payroll_reopen_events (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null
    references public.staff_payroll_monthly_snapshots(id)
    on delete restrict,
  approval_version_id uuid not null
    references public.staff_payroll_approval_versions(id)
    on delete restrict,
  month_start date not null,
  reopened_at timestamptz not null default now(),
  reopened_by uuid null references public.profiles(user_id) on delete set null,
  reopened_by_name_snapshot text not null,
  reason text not null,
  created_at timestamptz not null default now(),

  constraint staff_payroll_reopen_events_reason_chk
    check (char_length(btrim(reason)) between 3 and 1000),
  constraint staff_payroll_reopen_events_actor_name_chk
    check (char_length(btrim(reopened_by_name_snapshot)) between 1 and 200),
  unique (approval_version_id)
);

create index if not exists staff_payroll_reopen_events_month_idx
  on public.staff_payroll_reopen_events(month_start desc, reopened_at desc);

-- Approval history is immutable even for service-role application code.
create or replace function public.staff_payroll_reject_immutable_history_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'STAFF_PAYROLL_APPROVAL_HISTORY_IMMUTABLE';
end;
$$;

drop trigger if exists staff_payroll_approval_versions_immutable
  on public.staff_payroll_approval_versions;
create trigger staff_payroll_approval_versions_immutable
before update or delete on public.staff_payroll_approval_versions
for each row
execute function public.staff_payroll_reject_immutable_history_change();

drop trigger if exists staff_payroll_approval_calculations_immutable
  on public.staff_payroll_approval_calculations;
create trigger staff_payroll_approval_calculations_immutable
before update or delete on public.staff_payroll_approval_calculations
for each row
execute function public.staff_payroll_reject_immutable_history_change();

drop trigger if exists staff_payroll_reopen_events_immutable
  on public.staff_payroll_reopen_events;
create trigger staff_payroll_reopen_events_immutable
before update or delete on public.staff_payroll_reopen_events
for each row
execute function public.staff_payroll_reject_immutable_history_change();

alter table public.staff_payroll_approval_versions enable row level security;
alter table public.staff_payroll_approval_calculations enable row level security;
alter table public.staff_payroll_reopen_events enable row level security;

drop policy if exists "admin read staff payroll approval versions"
  on public.staff_payroll_approval_versions;
create policy "admin read staff payroll approval versions"
  on public.staff_payroll_approval_versions
  for select
  using (public.is_admin_or_super_admin(auth.uid()));

drop policy if exists "admin read staff payroll approval calculations"
  on public.staff_payroll_approval_calculations;
create policy "admin read staff payroll approval calculations"
  on public.staff_payroll_approval_calculations
  for select
  using (public.is_admin_or_super_admin(auth.uid()));

drop policy if exists "admin read staff payroll reopen events"
  on public.staff_payroll_reopen_events;
create policy "admin read staff payroll reopen events"
  on public.staff_payroll_reopen_events
  for select
  using (public.is_admin_or_super_admin(auth.uid()));

revoke all on table public.staff_payroll_approval_versions from authenticated;
revoke all on table public.staff_payroll_approval_calculations from authenticated;
revoke all on table public.staff_payroll_reopen_events from authenticated;

grant select on table public.staff_payroll_approval_versions to authenticated;
grant select on table public.staff_payroll_approval_calculations to authenticated;
grant select on table public.staff_payroll_reopen_events to authenticated;

grant all on table public.staff_payroll_approval_versions to service_role;
grant all on table public.staff_payroll_approval_calculations to service_role;
grant all on table public.staff_payroll_reopen_events to service_role;

-- DB-level lock: approved payroll months cannot have their operational task logs changed.
create or replace function public.staff_payroll_guard_locked_month_tasks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_month date;
  v_new_month date;
begin
  if tg_op in ('UPDATE','DELETE') then
    v_old_month := old.month_start;
    if exists (
      select 1
      from public.staff_payroll_monthly_snapshots s
      where s.month_start = v_old_month
        and s.status = 'approved'
    ) then
      raise exception 'STAFF_PAYROLL_MONTH_LOCKED';
    end if;
  end if;

  if tg_op in ('INSERT','UPDATE') then
    v_new_month := new.month_start;
    if exists (
      select 1
      from public.staff_payroll_monthly_snapshots s
      where s.month_start = v_new_month
        and s.status = 'approved'
    ) then
      raise exception 'STAFF_PAYROLL_MONTH_LOCKED';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_monthly_task_logs_guard_locked_month
  on public.staff_monthly_task_logs;
create trigger staff_monthly_task_logs_guard_locked_month
before insert or update or delete on public.staff_monthly_task_logs
for each row
execute function public.staff_payroll_guard_locked_month_tasks();

-- DB-level lock: approved snapshot rows can only transition through the dedicated approval/reopen RPCs.
create or replace function public.staff_payroll_guard_snapshot_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and old.status = 'approved' then
    raise exception 'STAFF_PAYROLL_SNAPSHOT_LOCKED';
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'approved' then
      if coalesce(current_setting('atom.staff_payroll_reopen', true), '') <> '1'
         or new.status <> 'draft' then
        raise exception 'STAFF_PAYROLL_SNAPSHOT_LOCKED';
      end if;
    elsif old.status = 'draft' and new.status = 'approved' then
      if coalesce(current_setting('atom.staff_payroll_approve', true), '') <> '1' then
        raise exception 'STAFF_PAYROLL_APPROVAL_RPC_REQUIRED';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_payroll_monthly_snapshots_guard_state
  on public.staff_payroll_monthly_snapshots;
create trigger staff_payroll_monthly_snapshots_guard_state
before update or delete on public.staff_payroll_monthly_snapshots
for each row
execute function public.staff_payroll_guard_snapshot_state();

-- DB-level lock: current calculation rows are immutable while their snapshot is approved.
create or replace function public.staff_payroll_guard_locked_calculations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot_id uuid;
begin
  if tg_op = 'INSERT' then
    v_snapshot_id := new.snapshot_id;
  else
    v_snapshot_id := old.snapshot_id;
  end if;

  if exists (
    select 1
    from public.staff_payroll_monthly_snapshots s
    where s.id = v_snapshot_id
      and s.status = 'approved'
  ) then
    raise exception 'STAFF_PAYROLL_SNAPSHOT_LOCKED';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_payroll_monthly_calculations_guard_locked
  on public.staff_payroll_monthly_calculations;
create trigger staff_payroll_monthly_calculations_guard_locked
before insert or update or delete on public.staff_payroll_monthly_calculations
for each row
execute function public.staff_payroll_guard_locked_calculations();

-- Atomic approval copy + lock. The API performs live-source hash verification immediately before this call.
create or replace function public.staff_payroll_approve_snapshot(
  p_snapshot_id uuid,
  p_actor_id uuid,
  p_approval_note text,
  p_financial_source_hash text,
  p_task_source_hash text,
  p_compensation_source_hash text,
  p_staff_source_hash text,
  p_draft_snapshot_hash text,
  p_draft_calculation_hash text
)
returns table(approval_version_id uuid, version_no integer, approved_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot public.staff_payroll_monthly_snapshots%rowtype;
  v_version integer;
  v_version_id uuid;
  v_now timestamptz := now();
  v_actor_name text;
  v_calc_count integer;
begin
  select * into v_snapshot
  from public.staff_payroll_monthly_snapshots
  where id = p_snapshot_id
  for update;

  if not found then
    raise exception 'STAFF_PAYROLL_SNAPSHOT_NOT_FOUND';
  end if;

  if v_snapshot.status <> 'draft' then
    raise exception 'STAFF_PAYROLL_NOT_DRAFT';
  end if;

  if v_snapshot.missing_hours_task_count <> 0 then
    raise exception 'STAFF_PAYROLL_MISSING_HOURS';
  end if;

  if v_snapshot.unconfigured_staff_count <> 0 then
    raise exception 'STAFF_PAYROLL_UNCONFIGURED_STAFF';
  end if;

  if v_snapshot.staff_count < 1 then
    raise exception 'STAFF_PAYROLL_NO_STAFF';
  end if;

  if v_snapshot.financial_source_hash is null
     or v_snapshot.task_source_hash is null
     or v_snapshot.compensation_source_hash is null
     or v_snapshot.staff_source_hash is null
     or v_snapshot.draft_snapshot_hash is null
     or v_snapshot.draft_calculation_hash is null then
    raise exception 'STAFF_PAYROLL_RECALC_REQUIRED';
  end if;

  if v_snapshot.financial_source_hash <> p_financial_source_hash
     or v_snapshot.task_source_hash <> p_task_source_hash
     or v_snapshot.compensation_source_hash <> p_compensation_source_hash
     or v_snapshot.staff_source_hash <> p_staff_source_hash
     or v_snapshot.draft_snapshot_hash <> p_draft_snapshot_hash
     or v_snapshot.draft_calculation_hash <> p_draft_calculation_hash then
    raise exception 'STAFF_PAYROLL_DRAFT_OUTDATED';
  end if;

  select count(*)::integer into v_calc_count
  from public.staff_payroll_monthly_calculations c
  where c.snapshot_id = p_snapshot_id;

  if v_calc_count <> v_snapshot.staff_count then
    raise exception 'STAFF_PAYROLL_CALCULATION_COUNT_MISMATCH';
  end if;

  select coalesce(
    nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
    nullif(btrim(p.email), ''),
    p_actor_id::text
  ) into v_actor_name
  from public.profiles p
  where p.user_id = p_actor_id;

  v_actor_name := coalesce(v_actor_name, p_actor_id::text);
  v_version := v_snapshot.approval_version_no + 1;

  insert into public.staff_payroll_approval_versions (
    snapshot_id,
    month_start,
    version_no,
    approved_at,
    approved_by,
    approved_by_name_snapshot,
    approval_note,
    calculated_payroll_total,
    staff_count,
    financial_source_hash,
    task_source_hash,
    compensation_source_hash,
    staff_source_hash,
    draft_snapshot_hash,
    draft_calculation_hash,
    snapshot_payload
  ) values (
    v_snapshot.id,
    v_snapshot.month_start,
    v_version,
    v_now,
    p_actor_id,
    v_actor_name,
    nullif(btrim(coalesce(p_approval_note, '')), ''),
    v_snapshot.calculated_payroll_total,
    v_snapshot.staff_count,
    v_snapshot.financial_source_hash,
    v_snapshot.task_source_hash,
    v_snapshot.compensation_source_hash,
    v_snapshot.staff_source_hash,
    v_snapshot.draft_snapshot_hash,
    v_snapshot.draft_calculation_hash,
    to_jsonb(v_snapshot) || jsonb_build_object(
      'status', 'approved',
      'approved_at', v_now,
      'approved_by', p_actor_id,
      'approval_version_no', v_version
    )
  ) returning id into v_version_id;

  insert into public.staff_payroll_approval_calculations (
    approval_version_id,
    snapshot_id,
    month_start,
    staff_user_id,
    staff_name_snapshot,
    staff_role_snapshot,
    compensation_configured,
    fixed_monthly_base,
    weighted_hour_rate,
    bonus_eligible,
    active_task_count,
    missing_hours_task_count,
    actual_hours,
    weighted_hours,
    task_compensation,
    guaranteed_compensation,
    bonus_weight_share_percent,
    performance_bonus,
    calculated_salary
  )
  select
    v_version_id,
    c.snapshot_id,
    c.month_start,
    c.staff_user_id,
    c.staff_name_snapshot,
    c.staff_role_snapshot,
    c.compensation_configured,
    c.fixed_monthly_base,
    c.weighted_hour_rate,
    c.bonus_eligible,
    c.active_task_count,
    c.missing_hours_task_count,
    c.actual_hours,
    c.weighted_hours,
    c.task_compensation,
    c.guaranteed_compensation,
    c.bonus_weight_share_percent,
    c.performance_bonus,
    c.calculated_salary
  from public.staff_payroll_monthly_calculations c
  where c.snapshot_id = p_snapshot_id;

  perform set_config('atom.staff_payroll_approve', '1', true);

  update public.staff_payroll_monthly_snapshots
  set status = 'approved',
      approval_version_no = v_version,
      approved_at = v_now,
      approved_by = p_actor_id,
      updated_by = p_actor_id
  where id = p_snapshot_id;

  return query select v_version_id, v_version, v_now;
end;
$$;

-- Atomic exceptional reopen. Approved versions remain immutable; reopen is a separate audit event.
create or replace function public.staff_payroll_reopen_snapshot(
  p_snapshot_id uuid,
  p_actor_id uuid,
  p_reason text
)
returns table(reopened_version_no integer, reopened_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot public.staff_payroll_monthly_snapshots%rowtype;
  v_version_id uuid;
  v_now timestamptz := now();
  v_actor_name text;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) < 3 then
    raise exception 'STAFF_PAYROLL_REOPEN_REASON_REQUIRED';
  end if;

  select * into v_snapshot
  from public.staff_payroll_monthly_snapshots
  where id = p_snapshot_id
  for update;

  if not found then
    raise exception 'STAFF_PAYROLL_SNAPSHOT_NOT_FOUND';
  end if;

  if v_snapshot.status <> 'approved' then
    raise exception 'STAFF_PAYROLL_NOT_APPROVED';
  end if;

  select id into v_version_id
  from public.staff_payroll_approval_versions
  where snapshot_id = p_snapshot_id
    and version_no = v_snapshot.approval_version_no;

  if v_version_id is null then
    raise exception 'STAFF_PAYROLL_APPROVAL_VERSION_NOT_FOUND';
  end if;

  select coalesce(
    nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
    nullif(btrim(p.email), ''),
    p_actor_id::text
  ) into v_actor_name
  from public.profiles p
  where p.user_id = p_actor_id;

  v_actor_name := coalesce(v_actor_name, p_actor_id::text);

  insert into public.staff_payroll_reopen_events (
    snapshot_id,
    approval_version_id,
    month_start,
    reopened_at,
    reopened_by,
    reopened_by_name_snapshot,
    reason
  ) values (
    p_snapshot_id,
    v_version_id,
    v_snapshot.month_start,
    v_now,
    p_actor_id,
    v_actor_name,
    v_reason
  );

  perform set_config('atom.staff_payroll_reopen', '1', true);

  update public.staff_payroll_monthly_snapshots
  set status = 'draft',
      approved_at = null,
      approved_by = null,
      last_reopened_at = v_now,
      last_reopened_by = p_actor_id,
      last_reopen_reason = v_reason,
      financial_source_hash = null,
      task_source_hash = null,
      compensation_source_hash = null,
      staff_source_hash = null,
      draft_snapshot_hash = null,
      draft_calculation_hash = null,
      updated_by = p_actor_id
  where id = p_snapshot_id;

  return query select v_snapshot.approval_version_no, v_now;
end;
$$;

revoke all on function public.staff_payroll_approve_snapshot(uuid,uuid,text,text,text,text,text,text,text) from public;
revoke all on function public.staff_payroll_reopen_snapshot(uuid,uuid,text) from public;
grant execute on function public.staff_payroll_approve_snapshot(uuid,uuid,text,text,text,text,text,text,text) to service_role;
grant execute on function public.staff_payroll_reopen_snapshot(uuid,uuid,text) to service_role;

comment on table public.staff_payroll_approval_versions is
  'Immutable Staff Payroll approval versions. Each approval preserves the financial snapshot and source-integrity hashes used at lock time.';
comment on table public.staff_payroll_approval_calculations is
  'Immutable per-staff salary calculations copied at approval time for future payment and payslip lots.';
comment on table public.staff_payroll_reopen_events is
  'Exceptional audit events recording why an approved payroll month was reopened. Reopening never deletes the prior approved version.';

commit;
