-- Staff Payroll 2K — Payroll Approval & Payment Closeout
-- Scope:
--   * Final payment closeout is separate from payroll approval and salary-payment recording.
--   * A current approved payroll version can only be closed when every non-negative salary due is fully paid.
--   * Closeout locks the salary-payment ledger for that approval version.
--   * Exceptional corrections require reopening the payment closeout with a mandatory reason.
--   * Closeout/reopen history is preserved permanently; rows are never deleted.
--   * Admin remains read-only; writes happen only through service-role RPCs called by Super Admin APIs.

begin;

create table if not exists public.staff_payroll_payment_closeouts (
  id uuid primary key default gen_random_uuid(),
  approval_version_id uuid not null
    references public.staff_payroll_approval_versions(id)
    on delete restrict,
  snapshot_id uuid not null
    references public.staff_payroll_monthly_snapshots(id)
    on delete restrict,
  month_start date not null,
  approval_version_no integer not null,
  approved_payroll_total numeric(14,2) not null,
  payable_salary_total numeric(14,2) not null,
  active_payment_total numeric(14,2) not null,
  active_payment_count integer not null,
  staff_count integer not null,
  status text not null default 'closed',
  closeout_note text null,
  closed_at timestamptz not null default now(),
  closed_by uuid null references public.profiles(user_id) on delete set null,
  closed_by_name_snapshot text not null,
  reopened_at timestamptz null,
  reopened_by uuid null references public.profiles(user_id) on delete set null,
  reopened_by_name_snapshot text null,
  reopen_reason text null,

  constraint staff_payroll_payment_closeouts_month_chk
    check (month_start = date_trunc('month', month_start)::date),
  constraint staff_payroll_payment_closeouts_version_chk
    check (approval_version_no >= 1),
  constraint staff_payroll_payment_closeouts_amounts_chk
    check (
      payable_salary_total >= 0
      and active_payment_total >= 0
    ),
  constraint staff_payroll_payment_closeouts_counts_chk
    check (active_payment_count >= 0 and staff_count >= 0),
  constraint staff_payroll_payment_closeouts_status_chk
    check (status in ('closed','reopened')),
  constraint staff_payroll_payment_closeouts_note_chk
    check (closeout_note is null or char_length(closeout_note) <= 2000),
  constraint staff_payroll_payment_closeouts_actor_name_chk
    check (char_length(btrim(closed_by_name_snapshot)) between 1 and 200),
  constraint staff_payroll_payment_closeouts_reopen_reason_chk
    check (reopen_reason is null or char_length(btrim(reopen_reason)) between 3 and 1000),
  constraint staff_payroll_payment_closeouts_reopen_state_chk
    check (
      (status = 'closed'
        and reopened_at is null
        and reopened_by is null
        and reopened_by_name_snapshot is null
        and reopen_reason is null)
      or
      (status = 'reopened'
        and reopened_at is not null
        and reopened_by_name_snapshot is not null
        and reopen_reason is not null)
    )
);

create index if not exists staff_payroll_payment_closeouts_month_idx
  on public.staff_payroll_payment_closeouts(month_start desc, closed_at desc);

create index if not exists staff_payroll_payment_closeouts_version_idx
  on public.staff_payroll_payment_closeouts(approval_version_id, closed_at desc);

create unique index if not exists staff_payroll_payment_closeouts_one_closed_version_idx
  on public.staff_payroll_payment_closeouts(approval_version_id)
  where status = 'closed';

alter table public.staff_payroll_payment_closeouts enable row level security;

drop policy if exists "admin read staff payroll payment closeouts"
  on public.staff_payroll_payment_closeouts;
create policy "admin read staff payroll payment closeouts"
  on public.staff_payroll_payment_closeouts
  for select
  using (public.is_admin_or_super_admin(auth.uid()));

revoke all on table public.staff_payroll_payment_closeouts from authenticated;
grant select on table public.staff_payroll_payment_closeouts to authenticated;
grant all on table public.staff_payroll_payment_closeouts to service_role;

-- Closeout rows are append-only. The only update is closed -> reopened through the dedicated RPC.
create or replace function public.staff_payroll_guard_payment_closeout_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(current_setting('atom.staff_payroll_payment_closeout', true), '') <> '1' then
      raise exception 'STAFF_PAYROLL_PAYMENT_CLOSEOUT_RPC_REQUIRED';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'STAFF_PAYROLL_PAYMENT_CLOSEOUT_IMMUTABLE';
  end if;

  if coalesce(current_setting('atom.staff_payroll_payment_closeout_reopen', true), '') <> '1' then
    raise exception 'STAFF_PAYROLL_PAYMENT_CLOSEOUT_IMMUTABLE';
  end if;

  if old.status <> 'closed' or new.status <> 'reopened' then
    raise exception 'STAFF_PAYROLL_PAYMENT_CLOSEOUT_INVALID_REOPEN';
  end if;

  if new.id <> old.id
     or new.approval_version_id <> old.approval_version_id
     or new.snapshot_id <> old.snapshot_id
     or new.month_start <> old.month_start
     or new.approval_version_no <> old.approval_version_no
     or new.approved_payroll_total <> old.approved_payroll_total
     or new.payable_salary_total <> old.payable_salary_total
     or new.active_payment_total <> old.active_payment_total
     or new.active_payment_count <> old.active_payment_count
     or new.staff_count <> old.staff_count
     or new.closeout_note is distinct from old.closeout_note
     or new.closed_at <> old.closed_at
     or new.closed_by is distinct from old.closed_by
     or new.closed_by_name_snapshot <> old.closed_by_name_snapshot then
    raise exception 'STAFF_PAYROLL_PAYMENT_CLOSEOUT_CORE_FIELDS_IMMUTABLE';
  end if;

  return new;
end;
$$;

drop trigger if exists staff_payroll_payment_closeouts_guard_mutation
  on public.staff_payroll_payment_closeouts;
create trigger staff_payroll_payment_closeouts_guard_mutation
before insert or update or delete on public.staff_payroll_payment_closeouts
for each row
execute function public.staff_payroll_guard_payment_closeout_mutation();

create or replace function public.staff_payroll_close_payment_cycle(
  p_approval_version_id uuid,
  p_actor_id uuid,
  p_note text
)
returns table(
  closeout_id uuid,
  closed_at timestamptz,
  paid_total numeric,
  payment_count integer,
  staff_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version public.staff_payroll_approval_versions%rowtype;
  v_snapshot public.staff_payroll_monthly_snapshots%rowtype;
  v_actor_name text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_now timestamptz := now();
  v_closeout_id uuid;
  v_staff_count integer := 0;
  v_unpaid_count integer := 0;
  v_payable_total numeric(14,2) := 0;
  v_paid_total numeric(14,2) := 0;
  v_payment_count integer := 0;
begin
  if v_note is not null and char_length(v_note) > 2000 then
    raise exception 'STAFF_PAYROLL_PAYMENT_CLOSEOUT_NOTE_TOO_LONG';
  end if;

  select * into v_version
  from public.staff_payroll_approval_versions
  where id = p_approval_version_id
  for update;

  if not found then
    raise exception 'STAFF_PAYROLL_APPROVAL_VERSION_NOT_FOUND';
  end if;

  select * into v_snapshot
  from public.staff_payroll_monthly_snapshots
  where id = v_version.snapshot_id
  for update;

  if not found then
    raise exception 'STAFF_PAYROLL_SNAPSHOT_NOT_FOUND';
  end if;

  if v_snapshot.status <> 'approved'
     or v_snapshot.approval_version_no <> v_version.version_no
     or v_snapshot.month_start <> v_version.month_start then
    raise exception 'STAFF_PAYROLL_PAYMENT_CLOSEOUT_NOT_CURRENT_APPROVAL';
  end if;

  if exists (
    select 1
    from public.staff_payroll_payment_closeouts c
    where c.approval_version_id = v_version.id
      and c.status = 'closed'
  ) then
    raise exception 'STAFF_PAYROLL_PAYMENT_CLOSEOUT_ALREADY_CLOSED';
  end if;

  -- Lock the active ledger rows before validating totals so a concurrent
  -- reversal cannot slip between the fully-paid check and the closeout insert.
  perform 1
  from public.staff_payroll_salary_payments p
  where p.approval_version_id = v_version.id
    and p.status = 'active'
  for update;

  select
    count(*)::integer,
    coalesce(sum(greatest(c.calculated_salary, 0)), 0)::numeric(14,2),
    count(*) filter (
      where greatest(c.calculated_salary, 0)
        - coalesce(paid.paid_amount, 0) > 0.005
    )::integer
  into v_staff_count, v_payable_total, v_unpaid_count
  from public.staff_payroll_approval_calculations c
  left join lateral (
    select coalesce(sum(p.amount), 0)::numeric(14,2) as paid_amount
    from public.staff_payroll_salary_payments p
    where p.approval_calculation_id = c.id
      and p.status = 'active'
  ) paid on true
  where c.approval_version_id = v_version.id;

  if v_staff_count < 1 then
    raise exception 'STAFF_PAYROLL_PAYMENT_CLOSEOUT_NO_STAFF';
  end if;

  if v_unpaid_count > 0 then
    raise exception 'STAFF_PAYROLL_PAYMENT_CLOSEOUT_NOT_FULLY_PAID';
  end if;

  select
    coalesce(sum(p.amount), 0)::numeric(14,2),
    count(*)::integer
  into v_paid_total, v_payment_count
  from public.staff_payroll_salary_payments p
  where p.approval_version_id = v_version.id
    and p.status = 'active';

  -- Defensive consistency check. Every positive salary must be exactly settled.
  if abs(v_paid_total - v_payable_total) > 0.005 then
    raise exception 'STAFF_PAYROLL_PAYMENT_CLOSEOUT_TOTAL_MISMATCH';
  end if;

  select coalesce(
    nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
    nullif(btrim(p.email), ''),
    p_actor_id::text
  ) into v_actor_name
  from public.profiles p
  where p.user_id = p_actor_id;

  v_actor_name := coalesce(v_actor_name, p_actor_id::text);

  perform set_config('atom.staff_payroll_payment_closeout', '1', true);

  insert into public.staff_payroll_payment_closeouts (
    approval_version_id,
    snapshot_id,
    month_start,
    approval_version_no,
    approved_payroll_total,
    payable_salary_total,
    active_payment_total,
    active_payment_count,
    staff_count,
    status,
    closeout_note,
    closed_at,
    closed_by,
    closed_by_name_snapshot
  ) values (
    v_version.id,
    v_snapshot.id,
    v_snapshot.month_start,
    v_version.version_no,
    v_version.calculated_payroll_total,
    v_payable_total,
    v_paid_total,
    v_payment_count,
    v_staff_count,
    'closed',
    v_note,
    v_now,
    p_actor_id,
    v_actor_name
  ) returning id into v_closeout_id;

  return query
  select v_closeout_id, v_now, v_paid_total, v_payment_count, v_staff_count;
end;
$$;

create or replace function public.staff_payroll_reopen_payment_closeout(
  p_closeout_id uuid,
  p_actor_id uuid,
  p_reason text
)
returns table(closeout_id uuid, reopened_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_closeout public.staff_payroll_payment_closeouts%rowtype;
  v_version public.staff_payroll_approval_versions%rowtype;
  v_snapshot public.staff_payroll_monthly_snapshots%rowtype;
  v_actor_name text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_now timestamptz := now();
begin
  if char_length(v_reason) < 3 then
    raise exception 'STAFF_PAYROLL_PAYMENT_CLOSEOUT_REOPEN_REASON_REQUIRED';
  end if;

  if char_length(v_reason) > 1000 then
    raise exception 'STAFF_PAYROLL_PAYMENT_CLOSEOUT_REOPEN_REASON_TOO_LONG';
  end if;

  select * into v_closeout
  from public.staff_payroll_payment_closeouts
  where id = p_closeout_id
  for update;

  if not found then
    raise exception 'STAFF_PAYROLL_PAYMENT_CLOSEOUT_NOT_FOUND';
  end if;

  if v_closeout.status <> 'closed' then
    raise exception 'STAFF_PAYROLL_PAYMENT_CLOSEOUT_ALREADY_REOPENED';
  end if;

  select * into v_version
  from public.staff_payroll_approval_versions
  where id = v_closeout.approval_version_id
  for update;

  if not found then
    raise exception 'STAFF_PAYROLL_APPROVAL_VERSION_NOT_FOUND';
  end if;

  select * into v_snapshot
  from public.staff_payroll_monthly_snapshots
  where id = v_closeout.snapshot_id
  for update;

  if not found then
    raise exception 'STAFF_PAYROLL_SNAPSHOT_NOT_FOUND';
  end if;

  if v_snapshot.status <> 'approved'
     or v_snapshot.approval_version_no <> v_closeout.approval_version_no
     or v_version.id <> v_closeout.approval_version_id then
    raise exception 'STAFF_PAYROLL_PAYMENT_CLOSEOUT_NOT_CURRENT_APPROVAL';
  end if;

  select coalesce(
    nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
    nullif(btrim(p.email), ''),
    p_actor_id::text
  ) into v_actor_name
  from public.profiles p
  where p.user_id = p_actor_id;

  v_actor_name := coalesce(v_actor_name, p_actor_id::text);

  perform set_config('atom.staff_payroll_payment_closeout_reopen', '1', true);

  update public.staff_payroll_payment_closeouts
  set status = 'reopened',
      reopened_at = v_now,
      reopened_by = p_actor_id,
      reopened_by_name_snapshot = v_actor_name,
      reopen_reason = v_reason
  where id = v_closeout.id;

  return query select v_closeout.id, v_now;
end;
$$;

revoke all on function public.staff_payroll_close_payment_cycle(uuid,uuid,text) from public;
revoke all on function public.staff_payroll_reopen_payment_closeout(uuid,uuid,text) from public;
grant execute on function public.staff_payroll_close_payment_cycle(uuid,uuid,text) to service_role;
grant execute on function public.staff_payroll_reopen_payment_closeout(uuid,uuid,text) to service_role;

-- A closed payment cycle freezes the salary-payment ledger for that approval version.
create or replace function public.staff_payroll_block_payment_after_closeout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version_id uuid;
begin
  v_version_id := case when tg_op = 'INSERT' then new.approval_version_id else old.approval_version_id end;

  if exists (
    select 1
    from public.staff_payroll_payment_closeouts c
    where c.approval_version_id = v_version_id
      and c.status = 'closed'
  ) then
    raise exception 'STAFF_PAYROLL_PAYMENT_CLOSEOUT_LOCKED';
  end if;

  return new;
end;
$$;

drop trigger if exists staff_payroll_salary_payments_block_closed_cycle
  on public.staff_payroll_salary_payments;
create trigger staff_payroll_salary_payments_block_closed_cycle
before insert or update on public.staff_payroll_salary_payments
for each row
execute function public.staff_payroll_block_payment_after_closeout();

-- Payroll approval itself cannot be reopened while the payment cycle is closed.
-- Required correction flow: reopen payment closeout -> reverse active payments -> reopen payroll approval if needed.
create or replace function public.staff_payroll_block_payroll_reopen_after_closeout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_version_id uuid;
begin
  if old.status = 'approved' and new.status = 'draft' then
    select id into v_current_version_id
    from public.staff_payroll_approval_versions
    where snapshot_id = old.id
      and version_no = old.approval_version_no;

    if v_current_version_id is not null and exists (
      select 1
      from public.staff_payroll_payment_closeouts c
      where c.approval_version_id = v_current_version_id
        and c.status = 'closed'
    ) then
      raise exception 'STAFF_PAYROLL_PAYMENT_CLOSEOUT_BLOCK_REOPEN';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists staff_payroll_monthly_snapshots_block_reopen_closeout
  on public.staff_payroll_monthly_snapshots;
create trigger staff_payroll_monthly_snapshots_block_reopen_closeout
before update of status on public.staff_payroll_monthly_snapshots
for each row
execute function public.staff_payroll_block_payroll_reopen_after_closeout();

comment on table public.staff_payroll_payment_closeouts is
  'Auditable Staff Payroll payment closeout history. Each closed cycle snapshots fully settled payment totals; exceptional reopen events preserve the original closeout row.';

commit;
