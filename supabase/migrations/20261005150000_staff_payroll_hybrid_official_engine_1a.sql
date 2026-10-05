-- Staff Payroll — Hybrid Official Engine 1A
-- Draft-only backend foundation for the validated hybrid model.
-- Defaults: Coach 400 EGP/session, Head Coach 300 EGP/session,
-- 0% safety reserve, 80% residual non-coaching pool.
-- Approval is intentionally blocked until the later approval-integration lot.

begin;

alter table public.staff_payroll_monthly_snapshots
  add column if not exists coach_session_rate numeric(12,2) not null default 0,
  add column if not exists head_coach_session_rate numeric(12,2) not null default 0,
  add column if not exists coach_session_count numeric(12,2) not null default 0,
  add column if not exists head_coach_session_count numeric(12,2) not null default 0,
  add column if not exists guaranteed_coaching_payroll numeric(14,2) not null default 0;

alter table public.staff_payroll_monthly_snapshots
  drop constraint if exists staff_payroll_monthly_snapshots_rate_model_chk,
  add constraint staff_payroll_monthly_snapshots_rate_model_chk
    check (rate_model in (
      'legacy_performance_bonus',
      'dynamic_task_rates',
      'variable_payroll_pool',
      'hybrid_payroll'
    )),
  drop constraint if exists staff_payroll_monthly_snapshots_hybrid_values_chk,
  add constraint staff_payroll_monthly_snapshots_hybrid_values_chk
    check (
      coach_session_rate >= 0
      and head_coach_session_rate >= 0
      and coach_session_count >= 0
      and head_coach_session_count >= 0
      and guaranteed_coaching_payroll >= 0
    );

alter table public.staff_payroll_monthly_calculations
  add column if not exists coaching_sessions numeric(12,2) not null default 0,
  add column if not exists coaching_session_rate numeric(12,2) not null default 0,
  add column if not exists coaching_guarantee numeric(14,2) not null default 0,
  add column if not exists non_coaching_weighted_hours numeric(14,4) not null default 0,
  add column if not exists non_coaching_variable_pay numeric(14,2) not null default 0;

alter table public.staff_payroll_monthly_calculations
  drop constraint if exists staff_payroll_monthly_calculations_hybrid_values_chk,
  add constraint staff_payroll_monthly_calculations_hybrid_values_chk
    check (
      coaching_sessions >= 0
      and coaching_session_rate >= 0
      and coaching_guarantee >= 0
      and non_coaching_weighted_hours >= 0
      and non_coaching_variable_pay >= 0
    );

create or replace function public.staff_payroll_block_hybrid_approval_1a()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'draft'
     and new.status = 'approved'
     and old.rate_model = 'hybrid_payroll' then
    raise exception 'STAFF_PAYROLL_HYBRID_APPROVAL_NOT_ENABLED';
  end if;
  return new;
end;
$$;

drop trigger if exists staff_payroll_monthly_snapshots_block_hybrid_approval_1a
  on public.staff_payroll_monthly_snapshots;

create trigger staff_payroll_monthly_snapshots_block_hybrid_approval_1a
before update of status on public.staff_payroll_monthly_snapshots
for each row
execute function public.staff_payroll_block_hybrid_approval_1a();

comment on column public.staff_payroll_monthly_snapshots.coach_session_rate is
  'Hybrid payroll guaranteed rate per validated coaching session for non-Head-Coach paid coaching.';
comment on column public.staff_payroll_monthly_snapshots.head_coach_session_rate is
  'Hybrid payroll guaranteed rate per validated Head Coach session.';
comment on column public.staff_payroll_monthly_snapshots.guaranteed_coaching_payroll is
  'Total guaranteed coaching compensation before non-coaching variable allocation.';
comment on column public.staff_payroll_monthly_calculations.coaching_guarantee is
  'Guaranteed coaching compensation for this staff member in the hybrid payroll model.';
comment on column public.staff_payroll_monthly_calculations.non_coaching_weighted_hours is
  'Only weighted hours from non-coaching tasks; coaching hours are excluded to prevent double compensation.';
comment on column public.staff_payroll_monthly_calculations.non_coaching_variable_pay is
  'Variable compensation allocated from the residual non-coaching pool.';

commit;
