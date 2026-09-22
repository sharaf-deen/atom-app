-- Staff Payroll 2F — Monthly Salary Adjustments
-- Scope:
--   * Super Admin can record monthly bonuses and deductions with a required reason.
--   * Adjustments are reversible (voided), never edited or deleted.
--   * Draft calculations snapshot adjustment totals and line details.
--   * Approved payroll months lock adjustments and preserve them in approval history.
--   * Admin remains read-only through RLS and application authorization.

begin;

create table if not exists public.staff_payroll_monthly_adjustments (
  id uuid primary key default gen_random_uuid(),
  month_start date not null,
  staff_user_id uuid not null references public.profiles(user_id) on delete restrict,
  staff_name_snapshot text not null,
  adjustment_type text not null,
  amount numeric(14,2) not null,
  reason text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(user_id) on delete set null,
  created_by_name_snapshot text not null,
  voided_at timestamptz null,
  voided_by uuid null references public.profiles(user_id) on delete set null,
  voided_by_name_snapshot text null,
  void_reason text null,

  constraint staff_payroll_monthly_adjustments_month_chk
    check (month_start = date_trunc('month', month_start)::date),
  constraint staff_payroll_monthly_adjustments_baseline_chk
    check (month_start >= date '2026-08-01'),
  constraint staff_payroll_monthly_adjustments_type_chk
    check (adjustment_type in ('bonus', 'deduction')),
  constraint staff_payroll_monthly_adjustments_amount_chk
    check (amount > 0),
  constraint staff_payroll_monthly_adjustments_reason_chk
    check (char_length(btrim(reason)) between 3 and 1000),
  constraint staff_payroll_monthly_adjustments_status_chk
    check (status in ('active', 'voided')),
  constraint staff_payroll_monthly_adjustments_staff_name_chk
    check (char_length(btrim(staff_name_snapshot)) between 1 and 200),
  constraint staff_payroll_monthly_adjustments_actor_name_chk
    check (char_length(btrim(created_by_name_snapshot)) between 1 and 200),
  constraint staff_payroll_monthly_adjustments_void_state_chk
    check (
      (status = 'active'
        and voided_at is null
        and voided_by is null
        and voided_by_name_snapshot is null
        and void_reason is null)
      or
      (status = 'voided'
        and voided_at is not null
        and voided_by is not null
        and char_length(btrim(voided_by_name_snapshot)) between 1 and 200
        and char_length(btrim(void_reason)) between 3 and 1000)
    )
);

create index if not exists staff_payroll_monthly_adjustments_month_idx
  on public.staff_payroll_monthly_adjustments(month_start desc, created_at desc);

create index if not exists staff_payroll_monthly_adjustments_staff_idx
  on public.staff_payroll_monthly_adjustments(staff_user_id, month_start desc);

alter table public.staff_payroll_monthly_snapshots
  add column if not exists salary_before_adjustments_total numeric(14,2) not null default 0,
  add column if not exists manual_bonus_total numeric(14,2) not null default 0,
  add column if not exists manual_deduction_total numeric(14,2) not null default 0,
  add column if not exists net_manual_adjustment_total numeric(14,2) not null default 0;

alter table public.staff_payroll_monthly_snapshots
  drop constraint if exists staff_payroll_monthly_snapshots_adjustments_chk;
alter table public.staff_payroll_monthly_snapshots
  add constraint staff_payroll_monthly_snapshots_adjustments_chk
  check (
    salary_before_adjustments_total >= 0
    and manual_bonus_total >= 0
    and manual_deduction_total >= 0
    and net_manual_adjustment_total = manual_bonus_total - manual_deduction_total
  );

alter table public.staff_payroll_monthly_calculations
  add column if not exists salary_before_adjustments numeric(14,2) not null default 0,
  add column if not exists manual_bonus numeric(14,2) not null default 0,
  add column if not exists manual_deduction numeric(14,2) not null default 0,
  add column if not exists net_manual_adjustment numeric(14,2) not null default 0,
  add column if not exists adjustment_breakdown jsonb not null default '[]'::jsonb;

alter table public.staff_payroll_monthly_calculations
  drop constraint if exists staff_payroll_monthly_calculations_adjustments_chk;
alter table public.staff_payroll_monthly_calculations
  add constraint staff_payroll_monthly_calculations_adjustments_chk
  check (
    salary_before_adjustments >= 0
    and manual_bonus >= 0
    and manual_deduction >= 0
    and net_manual_adjustment = manual_bonus - manual_deduction
    and calculated_salary >= 0
    and jsonb_typeof(adjustment_breakdown) = 'array'
    and (
      (
        salary_before_adjustments = 0
        and manual_bonus = 0
        and manual_deduction = 0
        and net_manual_adjustment = 0
        and adjustment_breakdown = '[]'::jsonb
      )
      or calculated_salary = salary_before_adjustments + net_manual_adjustment
    )
  );

alter table public.staff_payroll_approval_calculations
  add column if not exists salary_before_adjustments numeric(14,2) not null default 0,
  add column if not exists manual_bonus numeric(14,2) not null default 0,
  add column if not exists manual_deduction numeric(14,2) not null default 0,
  add column if not exists net_manual_adjustment numeric(14,2) not null default 0,
  add column if not exists adjustment_breakdown jsonb not null default '[]'::jsonb;

alter table public.staff_payroll_approval_calculations
  drop constraint if exists staff_payroll_approval_calculations_adjustments_chk;
alter table public.staff_payroll_approval_calculations
  add constraint staff_payroll_approval_calculations_adjustments_chk
  check (
    salary_before_adjustments >= 0
    and manual_bonus >= 0
    and manual_deduction >= 0
    and net_manual_adjustment = manual_bonus - manual_deduction
    and calculated_salary >= 0
    and jsonb_typeof(adjustment_breakdown) = 'array'
    and (
      (
        salary_before_adjustments = 0
        and manual_bonus = 0
        and manual_deduction = 0
        and net_manual_adjustment = 0
        and adjustment_breakdown = '[]'::jsonb
      )
      or calculated_salary = salary_before_adjustments + net_manual_adjustment
    )
  ) not valid;

alter table public.staff_payroll_approval_calculations
  validate constraint staff_payroll_approval_calculations_adjustments_chk;

create or replace function public.staff_payroll_guard_monthly_adjustment_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month_start date;
begin
  if tg_op = 'DELETE' then
    raise exception 'STAFF_PAYROLL_ADJUSTMENT_HISTORY_IMMUTABLE';
  end if;

  v_month_start := case when tg_op = 'INSERT' then new.month_start else old.month_start end;

  if exists (
    select 1
    from public.staff_payroll_monthly_snapshots s
    where s.month_start = v_month_start
      and s.status = 'approved'
  ) then
    raise exception 'STAFF_PAYROLL_MONTH_LOCKED';
  end if;

  if tg_op = 'UPDATE' then
    if new.id <> old.id
       or new.month_start <> old.month_start
       or new.staff_user_id <> old.staff_user_id
       or new.staff_name_snapshot <> old.staff_name_snapshot
       or new.adjustment_type <> old.adjustment_type
       or new.amount <> old.amount
       or new.reason <> old.reason
       or new.created_at <> old.created_at
       or new.created_by is distinct from old.created_by
       or new.created_by_name_snapshot <> old.created_by_name_snapshot then
      raise exception 'STAFF_PAYROLL_ADJUSTMENT_HISTORY_IMMUTABLE';
    end if;

    if old.status <> 'active'
       or new.status <> 'voided'
       or new.voided_at is null
       or new.voided_by is null
       or nullif(btrim(coalesce(new.voided_by_name_snapshot, '')), '') is null
       or char_length(btrim(coalesce(new.void_reason, ''))) < 3 then
      raise exception 'STAFF_PAYROLL_ADJUSTMENT_INVALID_VOID';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists staff_payroll_monthly_adjustments_guard_mutation
  on public.staff_payroll_monthly_adjustments;
create trigger staff_payroll_monthly_adjustments_guard_mutation
before insert or update or delete on public.staff_payroll_monthly_adjustments
for each row
execute function public.staff_payroll_guard_monthly_adjustment_mutation();

create or replace function public.staff_payroll_invalidate_draft_after_adjustment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.staff_payroll_monthly_snapshots
  set financial_source_hash = null,
      task_source_hash = null,
      compensation_source_hash = null,
      staff_source_hash = null,
      draft_snapshot_hash = null,
      draft_calculation_hash = null,
      updated_by = coalesce(new.voided_by, new.created_by)
  where month_start = new.month_start
    and status = 'draft';

  return new;
end;
$$;

drop trigger if exists staff_payroll_monthly_adjustments_invalidate_draft
  on public.staff_payroll_monthly_adjustments;
create trigger staff_payroll_monthly_adjustments_invalidate_draft
after insert or update on public.staff_payroll_monthly_adjustments
for each row
execute function public.staff_payroll_invalidate_draft_after_adjustment();

create or replace function public.staff_payroll_create_monthly_adjustment(
  p_month_start date,
  p_staff_user_id uuid,
  p_adjustment_type text,
  p_amount numeric,
  p_reason text,
  p_actor_id uuid
)
returns public.staff_payroll_monthly_adjustments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_name text;
  v_staff_role text;
  v_actor_name text;
  v_row public.staff_payroll_monthly_adjustments%rowtype;
begin
  if not public.is_super_admin(p_actor_id) then
    raise exception 'STAFF_PAYROLL_SUPER_ADMIN_REQUIRED';
  end if;

  if p_month_start is null
     or p_month_start <> date_trunc('month', p_month_start)::date
     or p_month_start < date '2026-08-01' then
    raise exception 'STAFF_PAYROLL_INVALID_MONTH';
  end if;

  if p_adjustment_type not in ('bonus', 'deduction') then
    raise exception 'STAFF_PAYROLL_INVALID_ADJUSTMENT_TYPE';
  end if;

  if p_amount is null or round(p_amount, 2) <= 0 then
    raise exception 'STAFF_PAYROLL_INVALID_ADJUSTMENT_AMOUNT';
  end if;

  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'STAFF_PAYROLL_ADJUSTMENT_REASON_REQUIRED';
  end if;

  select
    coalesce(
      nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
      nullif(btrim(p.email), ''),
      p.user_id::text
    ),
    p.role
  into v_staff_name, v_staff_role
  from public.profiles p
  where p.user_id = p_staff_user_id;

  if v_staff_name is null
     or v_staff_role not in ('assistant_coach','coach','head_coach','reception','admin','super_admin') then
    raise exception 'STAFF_PAYROLL_INVALID_STAFF';
  end if;

  select coalesce(
    nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
    nullif(btrim(p.email), ''),
    p.user_id::text
  ) into v_actor_name
  from public.profiles p
  where p.user_id = p_actor_id;

  insert into public.staff_payroll_monthly_adjustments (
    month_start,
    staff_user_id,
    staff_name_snapshot,
    adjustment_type,
    amount,
    reason,
    created_by,
    created_by_name_snapshot
  ) values (
    p_month_start,
    p_staff_user_id,
    v_staff_name,
    p_adjustment_type,
    round(p_amount, 2),
    btrim(p_reason),
    p_actor_id,
    coalesce(v_actor_name, p_actor_id::text)
  ) returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.staff_payroll_void_monthly_adjustment(
  p_adjustment_id uuid,
  p_reason text,
  p_actor_id uuid
)
returns public.staff_payroll_monthly_adjustments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_name text;
  v_row public.staff_payroll_monthly_adjustments%rowtype;
begin
  if not public.is_super_admin(p_actor_id) then
    raise exception 'STAFF_PAYROLL_SUPER_ADMIN_REQUIRED';
  end if;

  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'STAFF_PAYROLL_ADJUSTMENT_VOID_REASON_REQUIRED';
  end if;

  select * into v_row
  from public.staff_payroll_monthly_adjustments
  where id = p_adjustment_id
  for update;

  if not found then
    raise exception 'STAFF_PAYROLL_ADJUSTMENT_NOT_FOUND';
  end if;

  if v_row.status <> 'active' then
    raise exception 'STAFF_PAYROLL_ADJUSTMENT_ALREADY_VOIDED';
  end if;

  select coalesce(
    nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
    nullif(btrim(p.email), ''),
    p.user_id::text
  ) into v_actor_name
  from public.profiles p
  where p.user_id = p_actor_id;

  update public.staff_payroll_monthly_adjustments
  set status = 'voided',
      voided_at = now(),
      voided_by = p_actor_id,
      voided_by_name_snapshot = coalesce(v_actor_name, p_actor_id::text),
      void_reason = btrim(p_reason)
  where id = p_adjustment_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.staff_payroll_copy_adjustments_to_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_calculation public.staff_payroll_monthly_calculations%rowtype;
begin
  select * into v_calculation
  from public.staff_payroll_monthly_calculations c
  where c.snapshot_id = new.snapshot_id
    and c.staff_user_id = new.staff_user_id;

  if found then
    new.salary_before_adjustments := v_calculation.salary_before_adjustments;
    new.manual_bonus := v_calculation.manual_bonus;
    new.manual_deduction := v_calculation.manual_deduction;
    new.net_manual_adjustment := v_calculation.net_manual_adjustment;
    new.adjustment_breakdown := v_calculation.adjustment_breakdown;
  end if;

  return new;
end;
$$;

drop trigger if exists staff_payroll_approval_calculations_copy_adjustments
  on public.staff_payroll_approval_calculations;
create trigger staff_payroll_approval_calculations_copy_adjustments
before insert on public.staff_payroll_approval_calculations
for each row
execute function public.staff_payroll_copy_adjustments_to_approval();

alter table public.staff_payroll_monthly_adjustments enable row level security;

drop policy if exists "admin read staff payroll monthly adjustments"
  on public.staff_payroll_monthly_adjustments;
create policy "admin read staff payroll monthly adjustments"
  on public.staff_payroll_monthly_adjustments
  for select
  using (public.is_admin_or_super_admin(auth.uid()));

revoke all on table public.staff_payroll_monthly_adjustments from authenticated;
grant select on table public.staff_payroll_monthly_adjustments to authenticated;
grant all on table public.staff_payroll_monthly_adjustments to service_role;

revoke all on function public.staff_payroll_create_monthly_adjustment(date, uuid, text, numeric, text, uuid) from public;
revoke all on function public.staff_payroll_void_monthly_adjustment(uuid, text, uuid) from public;
grant execute on function public.staff_payroll_create_monthly_adjustment(date, uuid, text, numeric, text, uuid) to service_role;
grant execute on function public.staff_payroll_void_monthly_adjustment(uuid, text, uuid) to service_role;

comment on table public.staff_payroll_monthly_adjustments is
  'Audited monthly Staff Payroll bonuses and deductions. Rows are never edited or deleted; active rows may only be voided before payroll approval.';

comment on column public.staff_payroll_monthly_calculations.calculated_salary is
  'Final draft salary after performance bonus and active manual monthly adjustments.';

commit;
