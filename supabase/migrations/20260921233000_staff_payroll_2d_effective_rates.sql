-- Staff Payroll 2D — Effective-dated Compensation Rates
-- Scope:
--   * Compensation is versioned by payroll month; historical rates are not overwritten.
--   * A staff period provides the fixed monthly base, default weighted-hour rate and bonus eligibility.
--   * Optional task overrides replace the default weighted-hour rate for selected catalog tasks.
--   * Monthly calculations snapshot the applied period and per-task rates.
--   * Admin is read-only; Super Admin writes through the guarded RPC.

begin;

create table if not exists public.staff_compensation_rate_periods (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null
    references public.profiles(user_id)
    on delete restrict,
  effective_from date not null,
  effective_until date null,
  fixed_monthly_base numeric(12,2) not null default 0,
  weighted_hour_rate numeric(12,2) not null default 0,
  bonus_eligible boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.profiles(user_id) on delete set null,

  constraint staff_compensation_rate_periods_from_month_chk
    check (effective_from = date_trunc('month', effective_from)::date),
  constraint staff_compensation_rate_periods_until_month_chk
    check (effective_until is null or effective_until = date_trunc('month', effective_until)::date),
  constraint staff_compensation_rate_periods_range_chk
    check (effective_until is null or effective_until > effective_from),
  constraint staff_compensation_rate_periods_amounts_chk
    check (fixed_monthly_base >= 0 and weighted_hour_rate >= 0),
  unique (staff_user_id, effective_from)
);

create index if not exists staff_compensation_rate_periods_staff_dates_idx
  on public.staff_compensation_rate_periods(staff_user_id, effective_from desc, effective_until);

create table if not exists public.staff_compensation_task_rates (
  id uuid primary key default gen_random_uuid(),
  rate_period_id uuid not null
    references public.staff_compensation_rate_periods(id)
    on delete restrict,
  task_id uuid not null
    references public.staff_tasks(id)
    on delete restrict,
  weighted_hour_rate numeric(12,2) not null,
  created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.profiles(user_id) on delete set null,

  constraint staff_compensation_task_rates_amount_chk
    check (weighted_hour_rate >= 0),
  unique (rate_period_id, task_id)
);

create index if not exists staff_compensation_task_rates_period_idx
  on public.staff_compensation_task_rates(rate_period_id, task_id);

create or replace function public.staff_payroll_2d_touch_updated_at()
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

drop trigger if exists staff_compensation_rate_periods_touch_updated_at
  on public.staff_compensation_rate_periods;
create trigger staff_compensation_rate_periods_touch_updated_at
before update on public.staff_compensation_rate_periods
for each row
execute function public.staff_payroll_2d_touch_updated_at();

drop trigger if exists staff_compensation_task_rates_touch_updated_at
  on public.staff_compensation_task_rates;
create trigger staff_compensation_task_rates_touch_updated_at
before update on public.staff_compensation_task_rates
for each row
execute function public.staff_payroll_2d_touch_updated_at();

create or replace function public.staff_payroll_guard_rate_period_overlap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.staff_compensation_rate_periods p
    where p.staff_user_id = new.staff_user_id
      and p.id <> coalesce(new.id, gen_random_uuid())
      and p.effective_from < coalesce(new.effective_until, date '9999-12-01')
      and new.effective_from < coalesce(p.effective_until, date '9999-12-01')
  ) then
    raise exception 'STAFF_PAYROLL_RATE_PERIOD_OVERLAP';
  end if;

  return new;
end;
$$;

drop trigger if exists staff_compensation_rate_periods_no_overlap
  on public.staff_compensation_rate_periods;
create trigger staff_compensation_rate_periods_no_overlap
before insert or update on public.staff_compensation_rate_periods
for each row
execute function public.staff_payroll_guard_rate_period_overlap();

-- Add snapshot columns before compiling the approval-history guards that reference them.
alter table public.staff_payroll_monthly_calculations
  add column if not exists compensation_rate_period_id uuid null
    references public.staff_compensation_rate_periods(id) on delete restrict,
  add column if not exists compensation_effective_from date null,
  add column if not exists compensation_effective_until date null,
  add column if not exists task_rate_breakdown jsonb not null default '[]'::jsonb;

alter table public.staff_payroll_approval_calculations
  add column if not exists compensation_rate_period_id uuid null
    references public.staff_compensation_rate_periods(id) on delete restrict,
  add column if not exists compensation_effective_from date null,
  add column if not exists compensation_effective_until date null,
  add column if not exists task_rate_breakdown jsonb not null default '[]'::jsonb;

create or replace function public.staff_payroll_guard_used_rate_period()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_latest_approved_month date;
begin
  select max(c.month_start)
    into v_latest_approved_month
  from public.staff_payroll_approval_calculations c
  where c.compensation_rate_period_id = old.id
     or (
       c.compensation_rate_period_id is null
       and c.staff_user_id = old.staff_user_id
       and c.month_start >= old.effective_from
       and (old.effective_until is null or c.month_start < old.effective_until)
     );

  if v_latest_approved_month is null then
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'STAFF_PAYROLL_RATE_PERIOD_USED_BY_APPROVED_PAYROLL';
  end if;

  if new.staff_user_id <> old.staff_user_id
     or new.effective_from <> old.effective_from
     or new.fixed_monthly_base <> old.fixed_monthly_base
     or new.weighted_hour_rate <> old.weighted_hour_rate
     or new.bonus_eligible <> old.bonus_eligible then
    raise exception 'STAFF_PAYROLL_RATE_PERIOD_USED_BY_APPROVED_PAYROLL';
  end if;

  if new.effective_until is not null
     and new.effective_until <= v_latest_approved_month then
    raise exception 'STAFF_PAYROLL_RATE_PERIOD_ENDS_BEFORE_APPROVED_PAYROLL';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

alter table public.staff_payroll_monthly_calculations
  drop constraint if exists staff_payroll_monthly_calculations_task_rate_breakdown_chk;
alter table public.staff_payroll_monthly_calculations
  add constraint staff_payroll_monthly_calculations_task_rate_breakdown_chk
  check (jsonb_typeof(task_rate_breakdown) = 'array');

alter table public.staff_payroll_approval_calculations
  drop constraint if exists staff_payroll_approval_calculations_task_rate_breakdown_chk;
alter table public.staff_payroll_approval_calculations
  add constraint staff_payroll_approval_calculations_task_rate_breakdown_chk
  check (jsonb_typeof(task_rate_breakdown) = 'array');

drop trigger if exists staff_compensation_rate_periods_guard_used
  on public.staff_compensation_rate_periods;
create trigger staff_compensation_rate_periods_guard_used
before update or delete on public.staff_compensation_rate_periods
for each row
execute function public.staff_payroll_guard_used_rate_period();

create or replace function public.staff_payroll_guard_used_task_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_id uuid;
begin
  v_period_id := case when tg_op = 'DELETE' then old.rate_period_id else new.rate_period_id end;
  if exists (
    select 1
    from public.staff_payroll_approval_calculations c
    join public.staff_compensation_rate_periods p
      on p.id = v_period_id
    where c.compensation_rate_period_id = v_period_id
       or (
         c.compensation_rate_period_id is null
         and c.staff_user_id = p.staff_user_id
         and c.month_start >= p.effective_from
         and (p.effective_until is null or c.month_start < p.effective_until)
       )
  ) then
    raise exception 'STAFF_PAYROLL_TASK_RATE_USED_BY_APPROVED_PAYROLL';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_compensation_task_rates_guard_used
  on public.staff_compensation_task_rates;
create trigger staff_compensation_task_rates_guard_used
before insert or update or delete on public.staff_compensation_task_rates
for each row
execute function public.staff_payroll_guard_used_task_rate();

create or replace function public.staff_payroll_copy_rate_snapshot_to_approval()
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
    new.compensation_rate_period_id := v_calculation.compensation_rate_period_id;
    new.compensation_effective_from := v_calculation.compensation_effective_from;
    new.compensation_effective_until := v_calculation.compensation_effective_until;
    new.task_rate_breakdown := v_calculation.task_rate_breakdown;
  end if;

  return new;
end;
$$;

drop trigger if exists staff_payroll_approval_calculations_copy_rate_snapshot
  on public.staff_payroll_approval_calculations;
create trigger staff_payroll_approval_calculations_copy_rate_snapshot
before insert on public.staff_payroll_approval_calculations
for each row
execute function public.staff_payroll_copy_rate_snapshot_to_approval();

-- Preserve existing configured values as the first effective period.
insert into public.staff_compensation_rate_periods (
  staff_user_id,
  effective_from,
  effective_until,
  fixed_monthly_base,
  weighted_hour_rate,
  bonus_eligible,
  created_at,
  created_by,
  updated_at,
  updated_by
)
select
  p.staff_user_id,
  date '2026-08-01',
  null,
  p.fixed_monthly_base,
  p.weighted_hour_rate,
  p.bonus_eligible,
  p.created_at,
  p.created_by,
  p.updated_at,
  p.updated_by
from public.staff_compensation_profiles p
on conflict (staff_user_id, effective_from) do nothing;

create or replace function public.staff_payroll_save_rate_period(
  p_actor_id uuid,
  p_staff_user_id uuid,
  p_effective_from date,
  p_fixed_monthly_base numeric,
  p_weighted_hour_rate numeric,
  p_bonus_eligible boolean,
  p_task_rates jsonb,
  p_period_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_id uuid;
  v_previous_period_id uuid;
  v_next_start date;
  v_input_count integer;
  v_inserted_count integer;
begin
  if not public.is_super_admin(p_actor_id) then
    raise exception 'STAFF_PAYROLL_SUPER_ADMIN_REQUIRED';
  end if;

  if p_effective_from is null
     or p_effective_from <> date_trunc('month', p_effective_from)::date
     or p_effective_from < date '2026-08-01' then
    raise exception 'STAFF_PAYROLL_INVALID_EFFECTIVE_MONTH';
  end if;

  if p_fixed_monthly_base is null or p_fixed_monthly_base < 0
     or p_weighted_hour_rate is null or p_weighted_hour_rate < 0 then
    raise exception 'STAFF_PAYROLL_INVALID_RATE_AMOUNT';
  end if;

  if jsonb_typeof(coalesce(p_task_rates, '[]'::jsonb)) <> 'array' then
    raise exception 'STAFF_PAYROLL_INVALID_TASK_RATES';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.user_id = p_staff_user_id
      and p.role in ('assistant_coach','coach','head_coach','reception','admin','super_admin')
  ) then
    raise exception 'STAFF_PAYROLL_STAFF_PROFILE_NOT_ELIGIBLE';
  end if;

  if p_period_id is not null then
    select p.id into v_period_id
    from public.staff_compensation_rate_periods p
    where p.id = p_period_id
      and p.staff_user_id = p_staff_user_id
      and p.effective_from = p_effective_from
    for update;

    if v_period_id is null then
      raise exception 'STAFF_PAYROLL_RATE_PERIOD_NOT_FOUND';
    end if;

    update public.staff_compensation_rate_periods
    set fixed_monthly_base = round(p_fixed_monthly_base, 2),
        weighted_hour_rate = round(p_weighted_hour_rate, 2),
        bonus_eligible = coalesce(p_bonus_eligible, false),
        updated_by = p_actor_id
    where id = v_period_id;

    delete from public.staff_compensation_task_rates
    where rate_period_id = v_period_id;
  else
    if exists (
      select 1 from public.staff_compensation_rate_periods p
      where p.staff_user_id = p_staff_user_id
        and p.effective_from = p_effective_from
    ) then
      raise exception 'STAFF_PAYROLL_RATE_PERIOD_ALREADY_EXISTS';
    end if;

    select p.id into v_previous_period_id
    from public.staff_compensation_rate_periods p
    where p.staff_user_id = p_staff_user_id
      and p.effective_from < p_effective_from
      and (p.effective_until is null or p.effective_until > p_effective_from)
    order by p.effective_from desc
    limit 1
    for update;

    select min(p.effective_from) into v_next_start
    from public.staff_compensation_rate_periods p
    where p.staff_user_id = p_staff_user_id
      and p.effective_from > p_effective_from;

    if v_previous_period_id is not null then
      update public.staff_compensation_rate_periods
      set effective_until = p_effective_from,
          updated_by = p_actor_id
      where id = v_previous_period_id;
    end if;

    insert into public.staff_compensation_rate_periods (
      staff_user_id,
      effective_from,
      effective_until,
      fixed_monthly_base,
      weighted_hour_rate,
      bonus_eligible,
      created_by,
      updated_by
    ) values (
      p_staff_user_id,
      p_effective_from,
      v_next_start,
      round(p_fixed_monthly_base, 2),
      round(p_weighted_hour_rate, 2),
      coalesce(p_bonus_eligible, false),
      p_actor_id,
      p_actor_id
    ) returning id into v_period_id;
  end if;

  v_input_count := jsonb_array_length(coalesce(p_task_rates, '[]'::jsonb));

  insert into public.staff_compensation_task_rates (
    rate_period_id,
    task_id,
    weighted_hour_rate,
    created_by,
    updated_by
  )
  select
    v_period_id,
    t.id,
    round(x.weighted_hour_rate, 2),
    p_actor_id,
    p_actor_id
  from jsonb_to_recordset(coalesce(p_task_rates, '[]'::jsonb))
    as x(task_id uuid, weighted_hour_rate numeric)
  join public.staff_tasks t
    on t.id = x.task_id
   and t.is_active = true
  where x.weighted_hour_rate >= 0;

  get diagnostics v_inserted_count = row_count;
  if v_inserted_count <> v_input_count then
    raise exception 'STAFF_PAYROLL_INVALID_OR_DUPLICATE_TASK_RATE';
  end if;

  return v_period_id;
end;
$$;

alter table public.staff_compensation_rate_periods enable row level security;
alter table public.staff_compensation_task_rates enable row level security;

drop policy if exists "admin read staff compensation rate periods"
  on public.staff_compensation_rate_periods;
create policy "admin read staff compensation rate periods"
  on public.staff_compensation_rate_periods
  for select
  using (public.is_admin_or_super_admin(auth.uid()));

drop policy if exists "super admin insert staff compensation rate periods"
  on public.staff_compensation_rate_periods;
create policy "super admin insert staff compensation rate periods"
  on public.staff_compensation_rate_periods
  for insert
  with check (public.is_super_admin(auth.uid()));

drop policy if exists "super admin update staff compensation rate periods"
  on public.staff_compensation_rate_periods;
create policy "super admin update staff compensation rate periods"
  on public.staff_compensation_rate_periods
  for update
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

drop policy if exists "admin read staff compensation task rates"
  on public.staff_compensation_task_rates;
create policy "admin read staff compensation task rates"
  on public.staff_compensation_task_rates
  for select
  using (public.is_admin_or_super_admin(auth.uid()));

drop policy if exists "super admin insert staff compensation task rates"
  on public.staff_compensation_task_rates;
create policy "super admin insert staff compensation task rates"
  on public.staff_compensation_task_rates
  for insert
  with check (public.is_super_admin(auth.uid()));

drop policy if exists "super admin update staff compensation task rates"
  on public.staff_compensation_task_rates;
create policy "super admin update staff compensation task rates"
  on public.staff_compensation_task_rates
  for update
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

revoke all on table public.staff_compensation_rate_periods from authenticated;
revoke all on table public.staff_compensation_task_rates from authenticated;
grant select, insert, update on table public.staff_compensation_rate_periods to authenticated;
grant select, insert, update on table public.staff_compensation_task_rates to authenticated;
grant all on table public.staff_compensation_rate_periods to service_role;
grant all on table public.staff_compensation_task_rates to service_role;

revoke all on function public.staff_payroll_save_rate_period(uuid,uuid,date,numeric,numeric,boolean,jsonb,uuid) from public;
grant execute on function public.staff_payroll_save_rate_period(uuid,uuid,date,numeric,numeric,boolean,jsonb,uuid) to service_role;

comment on table public.staff_compensation_rate_periods is
  'Effective-dated Staff Payroll compensation periods. Ranges are month-aligned, non-overlapping and immutable once used by approved payroll.';
comment on table public.staff_compensation_task_rates is
  'Optional task-specific weighted-hour rates attached to an effective compensation period.';
comment on column public.staff_payroll_monthly_calculations.task_rate_breakdown is
  'Immutable calculation snapshot of each monthly task log, its applied rate source and resulting compensation.';

commit;
