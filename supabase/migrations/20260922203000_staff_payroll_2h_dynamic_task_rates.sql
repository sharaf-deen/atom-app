-- Staff Payroll 2H — Dynamic Task Rates & Guaranteed Minimums

begin;

create table if not exists public.staff_payroll_task_minimum_rate_periods (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.staff_tasks(id) on delete restrict,
  effective_from date not null,
  effective_until date null,
  minimum_hourly_rate numeric(12,2) not null,
  recommendation_basis jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.profiles(user_id) on delete set null,
  constraint staff_payroll_task_minimum_rates_month_chk
    check (effective_from = date_trunc('month', effective_from)::date
      and (effective_until is null or effective_until = date_trunc('month', effective_until)::date)),
  constraint staff_payroll_task_minimum_rates_range_chk
    check (effective_until is null or effective_until > effective_from),
  constraint staff_payroll_task_minimum_rates_amount_chk
    check (minimum_hourly_rate >= 0 and minimum_hourly_rate <= 1000000),
  constraint staff_payroll_task_minimum_rates_basis_chk
    check (jsonb_typeof(recommendation_basis) = 'object'),
  unique (task_id, effective_from)
);

create index if not exists staff_payroll_task_minimum_rates_lookup_idx
  on public.staff_payroll_task_minimum_rate_periods(task_id, effective_from desc, effective_until);

drop trigger if exists staff_payroll_task_minimum_rates_touch_updated_at
  on public.staff_payroll_task_minimum_rate_periods;
create trigger staff_payroll_task_minimum_rates_touch_updated_at
before update on public.staff_payroll_task_minimum_rate_periods
for each row execute function public.staff_payroll_touch_updated_at();

alter table public.staff_payroll_monthly_snapshots
  add column if not exists rate_model text not null default 'legacy_performance_bonus',
  add column if not exists safety_reserve_percent numeric(6,2) not null default 0,
  add column if not exists safety_reserve_amount numeric(14,2) not null default 0,
  add column if not exists minimum_task_payroll numeric(14,2) not null default 0,
  add column if not exists dynamic_task_supplement_pool numeric(14,2) not null default 0;

alter table public.staff_payroll_monthly_snapshots
  drop constraint if exists staff_payroll_monthly_snapshots_rate_model_chk,
  add constraint staff_payroll_monthly_snapshots_rate_model_chk
    check (rate_model in ('legacy_performance_bonus','dynamic_task_rates')),
  drop constraint if exists staff_payroll_monthly_snapshots_dynamic_values_chk,
  add constraint staff_payroll_monthly_snapshots_dynamic_values_chk
    check (safety_reserve_percent between 0 and 100
      and safety_reserve_amount >= 0
      and minimum_task_payroll >= 0
      and dynamic_task_supplement_pool >= 0);

alter table public.staff_payroll_monthly_calculations
  add column if not exists minimum_task_compensation numeric(14,2) not null default 0,
  add column if not exists dynamic_task_supplement numeric(14,2) not null default 0,
  add column if not exists dynamic_weight_share_percent numeric(7,2) not null default 0;

alter table public.staff_payroll_approval_calculations
  add column if not exists minimum_task_compensation numeric(14,2) not null default 0,
  add column if not exists dynamic_task_supplement numeric(14,2) not null default 0,
  add column if not exists dynamic_weight_share_percent numeric(7,2) not null default 0;

create or replace function public.staff_payroll_copy_dynamic_rate_snapshot_to_approval()
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
  where c.snapshot_id = new.snapshot_id and c.staff_user_id = new.staff_user_id;

  if found then
    new.minimum_task_compensation := v_calculation.minimum_task_compensation;
    new.dynamic_task_supplement := v_calculation.dynamic_task_supplement;
    new.dynamic_weight_share_percent := v_calculation.dynamic_weight_share_percent;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_payroll_approval_calculations_copy_dynamic_rates
  on public.staff_payroll_approval_calculations;
create trigger staff_payroll_approval_calculations_copy_dynamic_rates
before insert on public.staff_payroll_approval_calculations
for each row execute function public.staff_payroll_copy_dynamic_rate_snapshot_to_approval();

create or replace function public.staff_payroll_save_task_minimum_rates(
  p_effective_from date,
  p_rates jsonb,
  p_recommendation_basis jsonb,
  p_actor_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_task_id uuid;
  v_rate numeric(12,2);
  v_count integer := 0;
  v_active_count integer;
  v_latest_approved date;
  v_next_effective date;
begin
  if p_effective_from is null or p_effective_from <> date_trunc('month', p_effective_from)::date then
    raise exception 'STAFF_PAYROLL_INVALID_EFFECTIVE_MONTH';
  end if;
  if jsonb_typeof(p_rates) <> 'array' or jsonb_array_length(p_rates) = 0 then
    raise exception 'STAFF_PAYROLL_INVALID_TASK_MINIMUM_RATES';
  end if;
  if jsonb_typeof(coalesce(p_recommendation_basis, '{}'::jsonb)) <> 'object' then
    raise exception 'STAFF_PAYROLL_INVALID_RECOMMENDATION_BASIS';
  end if;

  select max(month_start) into v_latest_approved
  from public.staff_payroll_monthly_snapshots where status = 'approved';
  if v_latest_approved is not null and p_effective_from <= v_latest_approved then
    raise exception 'STAFF_PAYROLL_TASK_RATES_MUST_FOLLOW_APPROVED_MONTH';
  end if;

  select count(*) into v_active_count from public.staff_tasks where is_active;
  if jsonb_array_length(p_rates) <> v_active_count then
    raise exception 'STAFF_PAYROLL_ALL_ACTIVE_TASK_RATES_REQUIRED';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rates) x
    group by (x->>'task_id') having count(*) > 1
  ) then
    raise exception 'STAFF_PAYROLL_DUPLICATE_TASK_MINIMUM_RATE';
  end if;

  for v_item in select * from jsonb_array_elements(p_rates)
  loop
    begin
      v_task_id := (v_item->>'task_id')::uuid;
      v_rate := round((v_item->>'minimum_hourly_rate')::numeric, 2);
    exception when others then
      raise exception 'STAFF_PAYROLL_INVALID_TASK_MINIMUM_RATES';
    end;
    if v_rate < 0 or not exists (select 1 from public.staff_tasks t where t.id = v_task_id and t.is_active) then
      raise exception 'STAFF_PAYROLL_INVALID_TASK_MINIMUM_RATES';
    end if;

    update public.staff_payroll_task_minimum_rate_periods
    set effective_until = p_effective_from, updated_by = p_actor_id
    where task_id = v_task_id
      and effective_from < p_effective_from
      and (effective_until is null or effective_until > p_effective_from);

    select min(effective_from) into v_next_effective
    from public.staff_payroll_task_minimum_rate_periods
    where task_id = v_task_id and effective_from > p_effective_from;

    insert into public.staff_payroll_task_minimum_rate_periods(
      task_id, effective_from, effective_until, minimum_hourly_rate,
      recommendation_basis, created_by, updated_by
    ) values (
      v_task_id, p_effective_from, v_next_effective, v_rate,
      coalesce(p_recommendation_basis, '{}'::jsonb), p_actor_id, p_actor_id
    )
    on conflict (task_id, effective_from) do update
      set minimum_hourly_rate = excluded.minimum_hourly_rate,
          recommendation_basis = excluded.recommendation_basis,
          updated_by = excluded.updated_by;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

alter table public.staff_payroll_task_minimum_rate_periods enable row level security;
drop policy if exists "admin read staff payroll task minimum rates"
  on public.staff_payroll_task_minimum_rate_periods;
create policy "admin read staff payroll task minimum rates"
  on public.staff_payroll_task_minimum_rate_periods for select
  using (public.is_admin_or_super_admin(auth.uid()));

revoke all on table public.staff_payroll_task_minimum_rate_periods from authenticated;
grant select on table public.staff_payroll_task_minimum_rate_periods to authenticated;
grant all on table public.staff_payroll_task_minimum_rate_periods to service_role;
revoke all on function public.staff_payroll_save_task_minimum_rates(date,jsonb,jsonb,uuid) from public;
grant execute on function public.staff_payroll_save_task_minimum_rates(date,jsonb,jsonb,uuid) to service_role;

comment on table public.staff_payroll_task_minimum_rate_periods is
  'Effective-dated guaranteed minimum hourly rates per task. Approved history is never recalculated.';

commit;
