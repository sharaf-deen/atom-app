-- Staff Payroll 1B — Monthly Task Log
-- Monthly, auditable record of work actually performed by staff.
-- Governance:
--   * Admin / Super Admin can read.
--   * Only Super Admin can add/update/void monthly task logs.
--   * Records are never hard-deleted by the application.
--   * Each active row is unique by month + staff member + catalog task.
--   * Task/area/unit/importance are snapshotted when the monthly row is created.
--   * Salary calculation is intentionally NOT introduced in this lot.

begin;

create table if not exists public.staff_monthly_task_logs (
  id uuid primary key default gen_random_uuid(),
  month_start date not null,
  staff_user_id uuid not null
    references public.profiles(user_id)
    on delete restrict,
  task_id uuid not null
    references public.staff_tasks(id)
    on delete restrict,
  area_id_snapshot uuid null
    references public.staff_task_areas(id)
    on delete set null,
  task_name_snapshot text not null,
  area_name_snapshot text not null,
  unit_snapshot text not null,
  importance_level_snapshot text not null,
  importance_multiplier_snapshot numeric(5,2) not null,
  work_quantity numeric(10,2) not null default 1,
  actual_hours numeric(10,2) null,
  weighted_hours numeric(12,2)
    generated always as (
      round(coalesce(actual_hours, 0) * importance_multiplier_snapshot, 2)
    ) stored,
  note text null,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  created_by uuid null
    references public.profiles(user_id)
    on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid null
    references public.profiles(user_id)
    on delete set null,
  voided_at timestamptz null,
  voided_by uuid null
    references public.profiles(user_id)
    on delete set null,
  void_reason text null,

  constraint staff_monthly_task_logs_month_chk
    check (month_start = date_trunc('month', month_start)::date),
  constraint staff_monthly_task_logs_task_name_chk
    check (char_length(btrim(task_name_snapshot)) between 2 and 160),
  constraint staff_monthly_task_logs_area_name_chk
    check (char_length(btrim(area_name_snapshot)) between 2 and 100),
  constraint staff_monthly_task_logs_unit_chk
    check (unit_snapshot in ('hour','class','meeting','event','day','task','report','project')),
  constraint staff_monthly_task_logs_importance_level_chk
    check (importance_level_snapshot in ('standard','important','responsibility','high_responsibility','critical')),
  constraint staff_monthly_task_logs_importance_multiplier_chk
    check (importance_multiplier_snapshot between 0.50 and 5.00),
  constraint staff_monthly_task_logs_quantity_chk
    check (work_quantity > 0),
  constraint staff_monthly_task_logs_hours_chk
    check (actual_hours is null or actual_hours > 0),
  constraint staff_monthly_task_logs_hour_unit_chk
    check (unit_snapshot <> 'hour' or actual_hours is not null),
  constraint staff_monthly_task_logs_note_len_chk
    check (note is null or char_length(note) <= 2000),
  constraint staff_monthly_task_logs_source_chk
    check (source in ('manual','schedule','imported','adjustment')),
  constraint staff_monthly_task_logs_void_chk
    check (
      (voided_at is null and voided_by is null and void_reason is null)
      or
      (
        voided_at is not null
        and nullif(btrim(coalesce(void_reason, '')), '') is not null
        and char_length(void_reason) <= 500
      )
    )
);

create unique index if not exists staff_monthly_task_logs_active_uidx
  on public.staff_monthly_task_logs(month_start, staff_user_id, task_id)
  where voided_at is null;

create index if not exists staff_monthly_task_logs_staff_month_idx
  on public.staff_monthly_task_logs(staff_user_id, month_start desc, created_at desc);

create index if not exists staff_monthly_task_logs_month_idx
  on public.staff_monthly_task_logs(month_start desc, staff_user_id);

create index if not exists staff_monthly_task_logs_task_idx
  on public.staff_monthly_task_logs(task_id, month_start desc);

create or replace function public.staff_payroll_monthly_log_touch_updated_at()
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

drop trigger if exists staff_monthly_task_logs_touch_updated_at
  on public.staff_monthly_task_logs;
create trigger staff_monthly_task_logs_touch_updated_at
before update on public.staff_monthly_task_logs
for each row
execute function public.staff_payroll_monthly_log_touch_updated_at();

alter table public.staff_monthly_task_logs enable row level security;

drop policy if exists "admin read staff monthly task logs"
  on public.staff_monthly_task_logs;
create policy "admin read staff monthly task logs"
  on public.staff_monthly_task_logs
  for select
  using (public.is_admin_or_super_admin(auth.uid()));

drop policy if exists "super admin insert staff monthly task logs"
  on public.staff_monthly_task_logs;
create policy "super admin insert staff monthly task logs"
  on public.staff_monthly_task_logs
  for insert
  with check (public.is_super_admin(auth.uid()));

drop policy if exists "super admin update staff monthly task logs"
  on public.staff_monthly_task_logs;
create policy "super admin update staff monthly task logs"
  on public.staff_monthly_task_logs
  for update
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

revoke all on table public.staff_monthly_task_logs from authenticated;
grant select, insert, update on table public.staff_monthly_task_logs to authenticated;
grant all on table public.staff_monthly_task_logs to service_role;

comment on table public.staff_monthly_task_logs is
  'Staff Payroll monthly task log. One active row per month/staff/task, with task compensation metadata snapshotted at creation. Rows are voided rather than deleted.';
comment on column public.staff_monthly_task_logs.weighted_hours is
  'Actual hours multiplied by the task importance multiplier snapshot. Informational in 1B; salary calculation is introduced in a later lot.';

commit;
