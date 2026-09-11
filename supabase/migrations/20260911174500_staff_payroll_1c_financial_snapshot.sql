-- Staff Payroll 1C — Financial Snapshot & Salary Calculation Engine
-- Scope:
--   * Eligible revenue = subscription_payments only (cash-basis by paid_at, Cairo time).
--   * external_income_entries, Store revenue and Funding are intentionally excluded.
--   * Paid membership refunds reduce eligible membership revenue in the month they are paid.
--   * General expenses reduce the operating result, except payroll-type categories
--     ('coaches','reception','assistants','bonuses') which are excluded to avoid double counting.
--   * Draft salary = fixed monthly base + weighted task compensation + performance bonus.
--   * This lot does NOT approve payroll, lock a month, record salary payments or generate payslips.

begin;

create table if not exists public.staff_compensation_profiles (
  staff_user_id uuid primary key
    references public.profiles(user_id)
    on delete restrict,
  fixed_monthly_base numeric(12,2) not null default 0,
  weighted_hour_rate numeric(12,2) not null default 0,
  bonus_eligible boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.profiles(user_id) on delete set null,

  constraint staff_compensation_profiles_fixed_base_chk
    check (fixed_monthly_base >= 0),
  constraint staff_compensation_profiles_weighted_rate_chk
    check (weighted_hour_rate >= 0)
);

create table if not exists public.staff_payroll_monthly_snapshots (
  id uuid primary key default gen_random_uuid(),
  month_start date not null unique,
  status text not null default 'draft',
  eligible_revenue_scope text not null default 'membership_only',
  bonus_pool_percent numeric(6,2) not null default 0,

  membership_revenue numeric(14,2) not null default 0,
  membership_payment_count integer not null default 0,
  paid_membership_refunds numeric(14,2) not null default 0,
  paid_membership_refund_count integer not null default 0,
  net_membership_revenue numeric(14,2) not null default 0,

  eligible_operating_expenses numeric(14,2) not null default 0,
  eligible_expense_count integer not null default 0,
  excluded_payroll_expenses numeric(14,2) not null default 0,
  excluded_payroll_expense_count integer not null default 0,

  operating_result_before_payroll numeric(14,2) not null default 0,
  guaranteed_payroll numeric(14,2) not null default 0,
  available_result_after_guaranteed_payroll numeric(14,2) not null default 0,
  performance_bonus_pool numeric(14,2) not null default 0,
  calculated_payroll_total numeric(14,2) not null default 0,

  staff_count integer not null default 0,
  missing_hours_task_count integer not null default 0,
  unconfigured_staff_count integer not null default 0,

  calculated_at timestamptz not null default now(),
  calculated_by uuid null references public.profiles(user_id) on delete set null,
  source_data_as_of timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.profiles(user_id) on delete set null,

  constraint staff_payroll_monthly_snapshots_month_chk
    check (month_start = date_trunc('month', month_start)::date),
  constraint staff_payroll_monthly_snapshots_baseline_chk
    check (month_start >= date '2026-08-01'),
  constraint staff_payroll_monthly_snapshots_status_chk
    check (status in ('draft')),
  constraint staff_payroll_monthly_snapshots_scope_chk
    check (eligible_revenue_scope = 'membership_only'),
  constraint staff_payroll_monthly_snapshots_bonus_percent_chk
    check (bonus_pool_percent between 0 and 100),
  constraint staff_payroll_monthly_snapshots_counts_chk
    check (
      membership_payment_count >= 0
      and paid_membership_refund_count >= 0
      and eligible_expense_count >= 0
      and excluded_payroll_expense_count >= 0
      and staff_count >= 0
      and missing_hours_task_count >= 0
      and unconfigured_staff_count >= 0
    )
);

create table if not exists public.staff_payroll_monthly_calculations (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null
    references public.staff_payroll_monthly_snapshots(id)
    on delete cascade,
  month_start date not null,
  staff_user_id uuid not null
    references public.profiles(user_id)
    on delete restrict,
  staff_name_snapshot text not null,
  staff_role_snapshot text null,
  compensation_configured boolean not null default false,
  fixed_monthly_base numeric(12,2) not null default 0,
  weighted_hour_rate numeric(12,2) not null default 0,
  bonus_eligible boolean not null default true,
  active_task_count integer not null default 0,
  missing_hours_task_count integer not null default 0,
  actual_hours numeric(12,2) not null default 0,
  weighted_hours numeric(12,2) not null default 0,
  task_compensation numeric(14,2) not null default 0,
  guaranteed_compensation numeric(14,2) not null default 0,
  bonus_weight_share_percent numeric(9,4) not null default 0,
  performance_bonus numeric(14,2) not null default 0,
  calculated_salary numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint staff_payroll_monthly_calculations_month_chk
    check (month_start = date_trunc('month', month_start)::date),
  constraint staff_payroll_monthly_calculations_nonnegative_chk
    check (
      fixed_monthly_base >= 0
      and weighted_hour_rate >= 0
      and active_task_count >= 0
      and missing_hours_task_count >= 0
      and actual_hours >= 0
      and weighted_hours >= 0
      and task_compensation >= 0
      and guaranteed_compensation >= 0
      and bonus_weight_share_percent between 0 and 100
      and performance_bonus >= 0
      and calculated_salary >= 0
    ),
  constraint staff_payroll_monthly_calculations_staff_name_chk
    check (char_length(btrim(staff_name_snapshot)) between 1 and 200),
  unique (snapshot_id, staff_user_id)
);

create index if not exists staff_payroll_monthly_calculations_month_idx
  on public.staff_payroll_monthly_calculations(month_start desc, staff_name_snapshot);

create index if not exists staff_payroll_monthly_calculations_staff_idx
  on public.staff_payroll_monthly_calculations(staff_user_id, month_start desc);

create or replace function public.staff_payroll_1c_touch_updated_at()
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

drop trigger if exists staff_compensation_profiles_touch_updated_at
  on public.staff_compensation_profiles;
create trigger staff_compensation_profiles_touch_updated_at
before update on public.staff_compensation_profiles
for each row
execute function public.staff_payroll_1c_touch_updated_at();

drop trigger if exists staff_payroll_monthly_snapshots_touch_updated_at
  on public.staff_payroll_monthly_snapshots;
create trigger staff_payroll_monthly_snapshots_touch_updated_at
before update on public.staff_payroll_monthly_snapshots
for each row
execute function public.staff_payroll_1c_touch_updated_at();

drop trigger if exists staff_payroll_monthly_calculations_touch_updated_at
  on public.staff_payroll_monthly_calculations;
create trigger staff_payroll_monthly_calculations_touch_updated_at
before update on public.staff_payroll_monthly_calculations
for each row
execute function public.staff_payroll_1c_touch_updated_at();

alter table public.staff_compensation_profiles enable row level security;
alter table public.staff_payroll_monthly_snapshots enable row level security;
alter table public.staff_payroll_monthly_calculations enable row level security;

drop policy if exists "admin read staff compensation profiles"
  on public.staff_compensation_profiles;
create policy "admin read staff compensation profiles"
  on public.staff_compensation_profiles
  for select
  using (public.is_admin_or_super_admin(auth.uid()));

drop policy if exists "super admin insert staff compensation profiles"
  on public.staff_compensation_profiles;
create policy "super admin insert staff compensation profiles"
  on public.staff_compensation_profiles
  for insert
  with check (public.is_super_admin(auth.uid()));

drop policy if exists "super admin update staff compensation profiles"
  on public.staff_compensation_profiles;
create policy "super admin update staff compensation profiles"
  on public.staff_compensation_profiles
  for update
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

drop policy if exists "admin read staff payroll monthly snapshots"
  on public.staff_payroll_monthly_snapshots;
create policy "admin read staff payroll monthly snapshots"
  on public.staff_payroll_monthly_snapshots
  for select
  using (public.is_admin_or_super_admin(auth.uid()));

drop policy if exists "super admin insert staff payroll monthly snapshots"
  on public.staff_payroll_monthly_snapshots;
create policy "super admin insert staff payroll monthly snapshots"
  on public.staff_payroll_monthly_snapshots
  for insert
  with check (public.is_super_admin(auth.uid()));

drop policy if exists "super admin update staff payroll monthly snapshots"
  on public.staff_payroll_monthly_snapshots;
create policy "super admin update staff payroll monthly snapshots"
  on public.staff_payroll_monthly_snapshots
  for update
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

drop policy if exists "admin read staff payroll monthly calculations"
  on public.staff_payroll_monthly_calculations;
create policy "admin read staff payroll monthly calculations"
  on public.staff_payroll_monthly_calculations
  for select
  using (public.is_admin_or_super_admin(auth.uid()));

drop policy if exists "super admin insert staff payroll monthly calculations"
  on public.staff_payroll_monthly_calculations;
create policy "super admin insert staff payroll monthly calculations"
  on public.staff_payroll_monthly_calculations
  for insert
  with check (public.is_super_admin(auth.uid()));

drop policy if exists "super admin update staff payroll monthly calculations"
  on public.staff_payroll_monthly_calculations;
create policy "super admin update staff payroll monthly calculations"
  on public.staff_payroll_monthly_calculations
  for update
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

revoke all on table public.staff_compensation_profiles from authenticated;
revoke all on table public.staff_payroll_monthly_snapshots from authenticated;
revoke all on table public.staff_payroll_monthly_calculations from authenticated;

grant select, insert, update on table public.staff_compensation_profiles to authenticated;
grant select, insert, update on table public.staff_payroll_monthly_snapshots to authenticated;
grant select, insert, update on table public.staff_payroll_monthly_calculations to authenticated;

grant all on table public.staff_compensation_profiles to service_role;
grant all on table public.staff_payroll_monthly_snapshots to service_role;
grant all on table public.staff_payroll_monthly_calculations to service_role;

comment on table public.staff_compensation_profiles is
  'Current Staff Payroll compensation settings. Fixed base and weighted-hour rate are configured per staff profile; bonus eligibility is explicit.';
comment on table public.staff_payroll_monthly_snapshots is
  'Draft Staff Payroll financial snapshot. Eligible revenue is membership subscription payments only. External income, Store revenue and Funding are excluded.';
comment on table public.staff_payroll_monthly_calculations is
  'Draft per-staff salary calculation generated from the monthly financial snapshot and active Staff Payroll task logs. Approval/payment are introduced in later lots.';

commit;
