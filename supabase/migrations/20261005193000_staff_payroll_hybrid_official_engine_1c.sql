-- Staff Payroll — Hybrid Official Engine 1C
-- Approval Integration
begin;

alter table public.staff_payroll_approval_versions
  add column if not exists rate_model text not null default 'legacy_performance_bonus',
  add column if not exists coach_session_rate numeric(12,2) not null default 0,
  add column if not exists head_coach_session_rate numeric(12,2) not null default 0,
  add column if not exists coach_session_count numeric(12,2) not null default 0,
  add column if not exists head_coach_session_count numeric(12,2) not null default 0,
  add column if not exists fixed_base_payroll numeric(14,2) not null default 0,
  add column if not exists guaranteed_coaching_payroll numeric(14,2) not null default 0,
  add column if not exists variable_payroll_percent numeric(6,2) not null default 0,
  add column if not exists safety_reserve_percent numeric(6,2) not null default 0,
  add column if not exists safety_reserve_amount numeric(14,2) not null default 0,
  add column if not exists variable_payroll_pool numeric(14,2) not null default 0,
  add column if not exists variable_pool_weighted_hours numeric(14,4) not null default 0,
  add column if not exists variable_weighted_hour_value numeric(14,4) not null default 0;

alter table public.staff_payroll_approval_calculations
  add column if not exists coaching_sessions numeric(12,2) not null default 0,
  add column if not exists coaching_session_rate numeric(12,2) not null default 0,
  add column if not exists coaching_guarantee numeric(14,2) not null default 0,
  add column if not exists non_coaching_weighted_hours numeric(14,4) not null default 0,
  add column if not exists non_coaching_variable_pay numeric(14,2) not null default 0;

create or replace function public.staff_payroll_copy_hybrid_version_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot public.staff_payroll_monthly_snapshots%rowtype;
begin
  select * into v_snapshot
  from public.staff_payroll_monthly_snapshots
  where id = new.snapshot_id;

  if found then
    new.rate_model := v_snapshot.rate_model;
    new.coach_session_rate := v_snapshot.coach_session_rate;
    new.head_coach_session_rate := v_snapshot.head_coach_session_rate;
    new.coach_session_count := v_snapshot.coach_session_count;
    new.head_coach_session_count := v_snapshot.head_coach_session_count;
    new.fixed_base_payroll := v_snapshot.fixed_base_payroll;
    new.guaranteed_coaching_payroll := v_snapshot.guaranteed_coaching_payroll;
    new.variable_payroll_percent := v_snapshot.variable_payroll_percent;
    new.safety_reserve_percent := v_snapshot.safety_reserve_percent;
    new.safety_reserve_amount := v_snapshot.safety_reserve_amount;
    new.variable_payroll_pool := v_snapshot.variable_payroll_pool;
    new.variable_pool_weighted_hours := v_snapshot.variable_pool_weighted_hours;
    new.variable_weighted_hour_value := v_snapshot.variable_weighted_hour_value;
  end if;

  return new;
end;
$$;

drop trigger if exists staff_payroll_approval_versions_copy_hybrid
  on public.staff_payroll_approval_versions;
create trigger staff_payroll_approval_versions_copy_hybrid
before insert on public.staff_payroll_approval_versions
for each row execute function public.staff_payroll_copy_hybrid_version_fields();

create or replace function public.staff_payroll_copy_hybrid_calculation_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_calc public.staff_payroll_monthly_calculations%rowtype;
begin
  select * into v_calc
  from public.staff_payroll_monthly_calculations
  where snapshot_id = new.snapshot_id
    and staff_user_id = new.staff_user_id;

  if found then
    new.coaching_sessions := v_calc.coaching_sessions;
    new.coaching_session_rate := v_calc.coaching_session_rate;
    new.coaching_guarantee := v_calc.coaching_guarantee;
    new.non_coaching_weighted_hours := v_calc.non_coaching_weighted_hours;
    new.non_coaching_variable_pay := v_calc.non_coaching_variable_pay;
  end if;

  return new;
end;
$$;

drop trigger if exists staff_payroll_approval_calculations_copy_hybrid
  on public.staff_payroll_approval_calculations;
create trigger staff_payroll_approval_calculations_copy_hybrid
before insert on public.staff_payroll_approval_calculations
for each row execute function public.staff_payroll_copy_hybrid_calculation_fields();

drop trigger if exists staff_payroll_monthly_snapshots_block_hybrid_approval_1a
  on public.staff_payroll_monthly_snapshots;
drop function if exists public.staff_payroll_block_hybrid_approval_1a();

comment on column public.staff_payroll_approval_versions.guaranteed_coaching_payroll is
  'Immutable total guaranteed coaching payroll captured at hybrid approval.';
comment on column public.staff_payroll_approval_calculations.coaching_guarantee is
  'Immutable per-staff coaching guarantee captured at hybrid approval.';
comment on column public.staff_payroll_approval_calculations.non_coaching_variable_pay is
  'Immutable per-staff residual non-coaching allocation captured at hybrid approval.';

commit;
