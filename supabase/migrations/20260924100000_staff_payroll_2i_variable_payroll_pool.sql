-- Staff Payroll 2I — Variable Payroll Pool

begin;

alter table public.staff_payroll_monthly_snapshots
  add column if not exists variable_payroll_percent numeric(6,2) not null default 0,
  add column if not exists fixed_base_payroll numeric(14,2) not null default 0,
  add column if not exists variable_payroll_pool numeric(14,2) not null default 0,
  add column if not exists variable_pool_weighted_hours numeric(14,4) not null default 0,
  add column if not exists variable_weighted_hour_value numeric(14,4) not null default 0;

alter table public.staff_payroll_monthly_snapshots
  drop constraint if exists staff_payroll_monthly_snapshots_rate_model_chk,
  add constraint staff_payroll_monthly_snapshots_rate_model_chk
    check (rate_model in (
      'legacy_performance_bonus',
      'dynamic_task_rates',
      'variable_payroll_pool'
    )),
  drop constraint if exists staff_payroll_monthly_snapshots_variable_pool_values_chk,
  add constraint staff_payroll_monthly_snapshots_variable_pool_values_chk
    check (
      variable_payroll_percent between 0 and 100
      and fixed_base_payroll >= 0
      and variable_payroll_pool >= 0
      and variable_pool_weighted_hours >= 0
      and variable_weighted_hour_value >= 0
    );

comment on column public.staff_payroll_monthly_snapshots.variable_payroll_percent is
  'Share of the protected positive result allocated to variable task compensation.';
comment on column public.staff_payroll_monthly_snapshots.fixed_base_payroll is
  'Sum of fixed monthly bases deducted before the variable payroll pool is calculated.';
comment on column public.staff_payroll_monthly_snapshots.variable_payroll_pool is
  'Actual variable task compensation allocated for the payroll month.';
comment on column public.staff_payroll_monthly_snapshots.variable_pool_weighted_hours is
  'Eligible weighted hours used as the variable payroll pool distribution denominator.';
comment on column public.staff_payroll_monthly_snapshots.variable_weighted_hour_value is
  'Variable payroll pool divided by eligible weighted hours.';

commit;
