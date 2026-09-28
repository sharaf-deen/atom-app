-- Staff Payroll 2O — Staff Profiles & Default Task Assignments
-- Purpose:
--   * Create one canonical payroll identity per employee.
--   * Store payroll primary / secondary roles and employment status.
--   * Link secondary ATOM accounts to the canonical payroll account.
--   * Reuse staff_task_default_assignees as the employee's default task template.
--   * Protect future payroll writes from being posted to a linked secondary account.
--
-- Historical safety:
--   * Existing monthly task logs, calculations, approvals and payments are not rewritten.
--   * Existing task-log coefficient snapshots are not rewritten.
--   * Linking a secondary account is rejected when it still has an active/current
--     compensation period or current/future payroll work.

begin;

create table if not exists public.staff_payroll_staff_profiles (
  staff_user_id uuid primary key
    references public.profiles(user_id)
    on delete restrict,
  primary_role text not null,
  secondary_roles text[] not null default '{}'::text[],
  employment_status text not null default 'active',
  employment_start_date date null,
  employment_end_date date null,
  notes text null,
  created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.profiles(user_id) on delete set null,

  constraint staff_payroll_staff_profiles_primary_role_chk
    check (char_length(btrim(primary_role)) between 2 and 60),
  constraint staff_payroll_staff_profiles_secondary_roles_chk
    check (cardinality(secondary_roles) <= 12),
  constraint staff_payroll_staff_profiles_status_chk
    check (employment_status in ('active','inactive')),
  constraint staff_payroll_staff_profiles_dates_chk
    check (
      employment_end_date is null
      or employment_start_date is null
      or employment_end_date >= employment_start_date
    ),
  constraint staff_payroll_staff_profiles_notes_chk
    check (notes is null or char_length(notes) <= 2000)
);

create index if not exists staff_payroll_staff_profiles_status_idx
  on public.staff_payroll_staff_profiles(employment_status, primary_role);

create table if not exists public.staff_payroll_account_links (
  linked_user_id uuid primary key
    references public.profiles(user_id)
    on delete restrict,
  staff_user_id uuid not null
    references public.staff_payroll_staff_profiles(staff_user_id)
    on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(user_id) on delete set null,

  constraint staff_payroll_account_links_not_self_chk
    check (linked_user_id <> staff_user_id)
);

create index if not exists staff_payroll_account_links_staff_idx
  on public.staff_payroll_account_links(staff_user_id, linked_user_id);

create or replace function public.staff_payroll_2o_touch_updated_at()
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

drop trigger if exists staff_payroll_staff_profiles_touch_updated_at
  on public.staff_payroll_staff_profiles;
create trigger staff_payroll_staff_profiles_touch_updated_at
before update on public.staff_payroll_staff_profiles
for each row
execute function public.staff_payroll_2o_touch_updated_at();

create or replace function public.staff_payroll_is_secondary_account(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_payroll_account_links l
    where l.linked_user_id = p_user_id
  );
$$;

create or replace function public.staff_payroll_canonical_user_id(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select l.staff_user_id
      from public.staff_payroll_account_links l
      where l.linked_user_id = p_user_id
      limit 1
    ),
    p_user_id
  );
$$;

create or replace function public.staff_payroll_reject_secondary_account_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_user_id uuid;
begin
  v_staff_user_id := new.staff_user_id;

  if public.staff_payroll_is_secondary_account(v_staff_user_id) then
    raise exception 'STAFF_PAYROLL_SECONDARY_ACCOUNT_USE_CANONICAL';
  end if;

  return new;
end;
$$;

create or replace function public.staff_payroll_reject_secondary_default_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.staff_payroll_is_secondary_account(new.user_id) then
    raise exception 'STAFF_PAYROLL_SECONDARY_ACCOUNT_USE_CANONICAL';
  end if;
  return new;
end;
$$;

drop trigger if exists staff_task_default_assignees_canonical_guard
  on public.staff_task_default_assignees;
create trigger staff_task_default_assignees_canonical_guard
before insert or update on public.staff_task_default_assignees
for each row
execute function public.staff_payroll_reject_secondary_default_assignment();

drop trigger if exists staff_monthly_task_logs_canonical_guard
  on public.staff_monthly_task_logs;
create trigger staff_monthly_task_logs_canonical_guard
before insert or update on public.staff_monthly_task_logs
for each row
execute function public.staff_payroll_reject_secondary_account_write();

drop trigger if exists staff_compensation_rate_periods_canonical_guard
  on public.staff_compensation_rate_periods;
create trigger staff_compensation_rate_periods_canonical_guard
before insert or update on public.staff_compensation_rate_periods
for each row
execute function public.staff_payroll_reject_secondary_account_write();

drop trigger if exists staff_payroll_monthly_adjustments_canonical_guard
  on public.staff_payroll_monthly_adjustments;
create trigger staff_payroll_monthly_adjustments_canonical_guard
before insert or update on public.staff_payroll_monthly_adjustments
for each row
execute function public.staff_payroll_reject_secondary_account_write();

create or replace function public.staff_payroll_save_staff_profile(
  p_actor_id uuid,
  p_staff_user_id uuid,
  p_primary_role text,
  p_secondary_roles text[],
  p_employment_status text,
  p_employment_start_date date,
  p_employment_end_date date,
  p_notes text,
  p_linked_user_ids uuid[],
  p_default_task_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_month date :=
    date_trunc('month', timezone('Africa/Cairo', now()))::date;
  v_primary_role text := nullif(btrim(coalesce(p_primary_role, '')), '');
  v_secondary_roles text[] := coalesce(p_secondary_roles, '{}'::text[]);
  v_linked_user_ids uuid[] := coalesce(p_linked_user_ids, '{}'::uuid[]);
  v_default_task_ids uuid[] := coalesce(p_default_task_ids, '{}'::uuid[]);
  v_expected_count integer;
  v_inserted_count integer;
begin
  if not public.is_super_admin(p_actor_id) then
    raise exception 'STAFF_PAYROLL_SUPER_ADMIN_REQUIRED';
  end if;

  if p_staff_user_id is null then
    raise exception 'STAFF_PAYROLL_INVALID_STAFF_USER';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.user_id = p_staff_user_id
      and p.role in (
        'assistant_coach',
        'coach',
        'head_coach',
        'reception',
        'admin',
        'super_admin'
      )
  ) then
    raise exception 'STAFF_PAYROLL_STAFF_PROFILE_NOT_ELIGIBLE';
  end if;

  if public.staff_payroll_is_secondary_account(p_staff_user_id) then
    raise exception 'STAFF_PAYROLL_CANONICAL_ACCOUNT_ALREADY_LINKED';
  end if;

  if v_primary_role is null or char_length(v_primary_role) > 60 then
    raise exception 'STAFF_PAYROLL_INVALID_PRIMARY_ROLE';
  end if;

  if p_employment_status not in ('active','inactive') then
    raise exception 'STAFF_PAYROLL_INVALID_EMPLOYMENT_STATUS';
  end if;

  if p_employment_end_date is not null
     and p_employment_start_date is not null
     and p_employment_end_date < p_employment_start_date then
    raise exception 'STAFF_PAYROLL_INVALID_EMPLOYMENT_DATES';
  end if;

  if char_length(coalesce(p_notes, '')) > 2000 then
    raise exception 'STAFF_PAYROLL_NOTES_TOO_LONG';
  end if;

  if cardinality(v_secondary_roles) > 12 then
    raise exception 'STAFF_PAYROLL_TOO_MANY_SECONDARY_ROLES';
  end if;

  if exists (
    select 1
    from unnest(v_secondary_roles) as role_name
    where nullif(btrim(role_name), '') is null
       or char_length(btrim(role_name)) > 60
  ) then
    raise exception 'STAFF_PAYROLL_INVALID_SECONDARY_ROLE';
  end if;

  if cardinality(v_linked_user_ids) <> (
    select count(distinct x)
    from unnest(v_linked_user_ids) as x
  ) then
    raise exception 'STAFF_PAYROLL_DUPLICATE_LINKED_ACCOUNT';
  end if;

  if p_staff_user_id = any(v_linked_user_ids) then
    raise exception 'STAFF_PAYROLL_CANNOT_LINK_CANONICAL_TO_ITSELF';
  end if;

  if exists (
    select 1
    from unnest(v_linked_user_ids) as linked_id
    left join public.profiles p on p.user_id = linked_id
    where p.user_id is null
       or p.role not in (
         'assistant_coach',
         'coach',
         'head_coach',
         'reception',
         'admin',
         'super_admin'
       )
  ) then
    raise exception 'STAFF_PAYROLL_LINKED_ACCOUNT_NOT_ELIGIBLE';
  end if;

  if exists (
    select 1
    from public.staff_payroll_staff_profiles sp
    where sp.staff_user_id = any(v_linked_user_ids)
      and sp.staff_user_id <> p_staff_user_id
  ) then
    raise exception 'STAFF_PAYROLL_LINKED_ACCOUNT_IS_ANOTHER_CANONICAL_PROFILE';
  end if;

  if exists (
    select 1
    from public.staff_payroll_account_links l
    where l.linked_user_id = any(v_linked_user_ids)
      and l.staff_user_id <> p_staff_user_id
  ) then
    raise exception 'STAFF_PAYROLL_LINKED_ACCOUNT_ALREADY_ASSIGNED';
  end if;

  -- A secondary account must not carry current/future payroll configuration.
  -- Historical approved records are intentionally left untouched.
  if exists (
    select 1
    from public.staff_compensation_rate_periods r
    where r.staff_user_id = any(v_linked_user_ids)
      and (
        r.effective_until is null
        or r.effective_until > v_current_month
      )
  ) then
    raise exception 'STAFF_PAYROLL_SECONDARY_ACCOUNT_HAS_ACTIVE_COMPENSATION';
  end if;

  if exists (
    select 1
    from public.staff_monthly_task_logs l
    where l.staff_user_id = any(v_linked_user_ids)
      and l.month_start >= v_current_month
      and l.voided_at is null
  ) then
    raise exception 'STAFF_PAYROLL_SECONDARY_ACCOUNT_HAS_CURRENT_TASKS';
  end if;

  if exists (
    select 1
    from public.staff_payroll_monthly_adjustments a
    where a.staff_user_id = any(v_linked_user_ids)
      and a.month_start >= v_current_month
      and a.status = 'active'
  ) then
    raise exception 'STAFF_PAYROLL_SECONDARY_ACCOUNT_HAS_CURRENT_ADJUSTMENTS';
  end if;

  -- Validate task IDs before changing existing defaults.
  v_expected_count := cardinality(v_default_task_ids);

  if v_expected_count <> (
    select count(distinct x)
    from unnest(v_default_task_ids) as x
  ) then
    raise exception 'STAFF_PAYROLL_DUPLICATE_DEFAULT_TASK';
  end if;

  if exists (
    select 1
    from unnest(v_default_task_ids) as task_id
    left join public.staff_tasks t on t.id = task_id
    where t.id is null or t.is_active is not true
  ) then
    raise exception 'STAFF_PAYROLL_INVALID_DEFAULT_TASK';
  end if;

  insert into public.staff_payroll_staff_profiles (
    staff_user_id,
    primary_role,
    secondary_roles,
    employment_status,
    employment_start_date,
    employment_end_date,
    notes,
    created_by,
    updated_by
  ) values (
    p_staff_user_id,
    v_primary_role,
    v_secondary_roles,
    p_employment_status,
    p_employment_start_date,
    p_employment_end_date,
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_actor_id,
    p_actor_id
  )
  on conflict (staff_user_id)
  do update set
    primary_role = excluded.primary_role,
    secondary_roles = excluded.secondary_roles,
    employment_status = excluded.employment_status,
    employment_start_date = excluded.employment_start_date,
    employment_end_date = excluded.employment_end_date,
    notes = excluded.notes,
    updated_by = p_actor_id;

  delete from public.staff_payroll_account_links
  where staff_user_id = p_staff_user_id;

  insert into public.staff_payroll_account_links (
    linked_user_id,
    staff_user_id,
    created_by
  )
  select distinct
    linked_id,
    p_staff_user_id,
    p_actor_id
  from unnest(v_linked_user_ids) as linked_id;

  delete from public.staff_task_default_assignees
  where user_id = p_staff_user_id;

  insert into public.staff_task_default_assignees (
    task_id,
    user_id,
    created_by
  )
  select distinct
    task_id,
    p_staff_user_id,
    p_actor_id
  from unnest(v_default_task_ids) as task_id
  join public.staff_tasks t on t.id = task_id
  where t.is_active = true;

  get diagnostics v_inserted_count = row_count;
  if v_inserted_count <> v_expected_count then
    raise exception 'STAFF_PAYROLL_DEFAULT_TASK_SAVE_MISMATCH';
  end if;

  return p_staff_user_id;
end;
$$;

alter table public.staff_payroll_staff_profiles enable row level security;
alter table public.staff_payroll_account_links enable row level security;

drop policy if exists "admin read staff payroll staff profiles"
  on public.staff_payroll_staff_profiles;
create policy "admin read staff payroll staff profiles"
  on public.staff_payroll_staff_profiles
  for select
  using (public.is_admin_or_super_admin(auth.uid()));

drop policy if exists "super admin insert staff payroll staff profiles"
  on public.staff_payroll_staff_profiles;
create policy "super admin insert staff payroll staff profiles"
  on public.staff_payroll_staff_profiles
  for insert
  with check (public.is_super_admin(auth.uid()));

drop policy if exists "super admin update staff payroll staff profiles"
  on public.staff_payroll_staff_profiles;
create policy "super admin update staff payroll staff profiles"
  on public.staff_payroll_staff_profiles
  for update
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

drop policy if exists "admin read staff payroll account links"
  on public.staff_payroll_account_links;
create policy "admin read staff payroll account links"
  on public.staff_payroll_account_links
  for select
  using (public.is_admin_or_super_admin(auth.uid()));

drop policy if exists "super admin insert staff payroll account links"
  on public.staff_payroll_account_links;
create policy "super admin insert staff payroll account links"
  on public.staff_payroll_account_links
  for insert
  with check (public.is_super_admin(auth.uid()));

drop policy if exists "super admin delete staff payroll account links"
  on public.staff_payroll_account_links;
create policy "super admin delete staff payroll account links"
  on public.staff_payroll_account_links
  for delete
  using (public.is_super_admin(auth.uid()));

revoke all on table public.staff_payroll_staff_profiles from authenticated;
revoke all on table public.staff_payroll_account_links from authenticated;
grant select, insert, update on table public.staff_payroll_staff_profiles to authenticated;
grant select, insert, delete on table public.staff_payroll_account_links to authenticated;
grant all on table public.staff_payroll_staff_profiles to service_role;
grant all on table public.staff_payroll_account_links to service_role;

revoke all on function public.staff_payroll_is_secondary_account(uuid) from public;
revoke all on function public.staff_payroll_canonical_user_id(uuid) from public;
revoke all on function public.staff_payroll_save_staff_profile(uuid,uuid,text,text[],text,date,date,text,uuid[],uuid[]) from public;

grant execute on function public.staff_payroll_is_secondary_account(uuid) to service_role;
grant execute on function public.staff_payroll_canonical_user_id(uuid) to service_role;
grant execute on function public.staff_payroll_save_staff_profile(uuid,uuid,text,text[],text,date,date,text,uuid[],uuid[]) to service_role;

comment on table public.staff_payroll_staff_profiles is
  'Canonical Staff Payroll employee profiles. One canonical payroll user per employee, independent from secondary application accounts.';
comment on table public.staff_payroll_account_links is
  'Secondary ATOM accounts linked to one canonical Staff Payroll employee identity. Future payroll writes must use the canonical staff_user_id.';
comment on function public.staff_payroll_save_staff_profile(uuid,uuid,text,text[],text,date,date,text,uuid[],uuid[]) is
  'Atomic Super Admin save for Staff Payroll 2O employee profile, linked accounts and default task template. Historical payroll snapshots are never rewritten.';

commit;
