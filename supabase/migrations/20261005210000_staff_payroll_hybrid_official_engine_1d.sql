-- Staff Payroll — Hybrid Official Engine 1D
-- Payment & Closeout Integration

begin;

alter table public.staff_payroll_payment_closeouts
  add column if not exists rate_model text not null default 'legacy_performance_bonus',
  add column if not exists guaranteed_coaching_payroll numeric(14,2) not null default 0,
  add column if not exists variable_payroll_pool numeric(14,2) not null default 0,
  add column if not exists variable_pool_weighted_hours numeric(14,4) not null default 0,
  add column if not exists variable_weighted_hour_value numeric(14,4) not null default 0;

alter table public.staff_payroll_payment_closeouts
  drop constraint if exists staff_payroll_payment_closeouts_hybrid_context_chk,
  add constraint staff_payroll_payment_closeouts_hybrid_context_chk
    check (
      guaranteed_coaching_payroll >= 0
      and variable_payroll_pool >= 0
      and variable_pool_weighted_hours >= 0
      and variable_weighted_hour_value >= 0
    );

create or replace function public.staff_payroll_copy_hybrid_context_to_closeout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version public.staff_payroll_approval_versions%rowtype;
begin
  select * into v_version
  from public.staff_payroll_approval_versions
  where id = new.approval_version_id;

  if found then
    new.rate_model := v_version.rate_model;
    new.guaranteed_coaching_payroll := v_version.guaranteed_coaching_payroll;
    new.variable_payroll_pool := v_version.variable_payroll_pool;
    new.variable_pool_weighted_hours := v_version.variable_pool_weighted_hours;
    new.variable_weighted_hour_value := v_version.variable_weighted_hour_value;
  end if;

  return new;
end;
$$;

drop trigger if exists staff_payroll_payment_closeouts_copy_hybrid_context
  on public.staff_payroll_payment_closeouts;
create trigger staff_payroll_payment_closeouts_copy_hybrid_context
before insert on public.staff_payroll_payment_closeouts
for each row
execute function public.staff_payroll_copy_hybrid_context_to_closeout();

comment on column public.staff_payroll_payment_closeouts.rate_model is
  'Immutable payroll model copied from the approval version at payment closeout.';
comment on column public.staff_payroll_payment_closeouts.guaranteed_coaching_payroll is
  'Immutable guaranteed coaching total copied from the approved hybrid payroll at closeout.';
comment on column public.staff_payroll_payment_closeouts.variable_payroll_pool is
  'Immutable non-coaching residual pool copied from the approved hybrid payroll at closeout.';

commit;
