-- Staff Payroll 1A — Task Catalog & Compensation Foundation
-- Source catalog: ATOM Tasks / Roles / Hours / Salary Planning (59 tasks).
-- Governance:
--   * Admin / Super Admin can read.
--   * Only Super Admin can create/update/deactivate areas/tasks and default assignments.
--   * Tasks and areas are never hard-deleted by the application.
--   * Initial importance is deliberately neutral (Standard / 1.00) because the source document
--     does not define compensation weights. Super Admin can classify them before payroll calculation lots.
--   * Source assignment labels are preserved as planning hints only; actual default assignees
--     are linked explicitly to profiles through staff_task_default_assignees.

begin;

create table if not exists public.staff_task_areas (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.profiles(user_id) on delete set null,

  constraint staff_task_areas_slug_chk
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint staff_task_areas_name_chk
    check (char_length(btrim(name)) between 2 and 100),
  constraint staff_task_areas_sort_chk
    check (sort_order >= 0)
);

create unique index if not exists staff_task_areas_name_ci_uidx
  on public.staff_task_areas (lower(btrim(name)));

create table if not exists public.staff_tasks (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null
    references public.staff_task_areas(id)
    on delete restrict,
  source_key text null unique,
  name text not null,
  frequency_label text null,
  estimated_time_label text null,
  estimated_min_hours_per_week numeric(6,2) null,
  estimated_max_hours_per_week numeric(6,2) null,
  unit text not null default 'hour',
  importance_level text not null default 'standard',
  importance_multiplier numeric(5,2) not null default 1.00,
  source_assignment_label text null,
  notes text null,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.profiles(user_id) on delete set null,

  constraint staff_tasks_name_chk
    check (char_length(btrim(name)) between 2 and 160),
  constraint staff_tasks_frequency_len_chk
    check (frequency_label is null or char_length(frequency_label) <= 120),
  constraint staff_tasks_estimated_time_len_chk
    check (estimated_time_label is null or char_length(estimated_time_label) <= 120),
  constraint staff_tasks_estimated_hours_chk
    check (
      (estimated_min_hours_per_week is null or estimated_min_hours_per_week >= 0)
      and
      (estimated_max_hours_per_week is null or estimated_max_hours_per_week >= 0)
      and
      (
        estimated_min_hours_per_week is null
        or estimated_max_hours_per_week is null
        or estimated_max_hours_per_week >= estimated_min_hours_per_week
      )
    ),
  constraint staff_tasks_unit_chk
    check (unit in ('hour','class','meeting','event','day','task','report','project')),
  constraint staff_tasks_importance_level_chk
    check (importance_level in ('standard','important','responsibility','high_responsibility','critical')),
  constraint staff_tasks_importance_multiplier_chk
    check (importance_multiplier between 0.50 and 5.00),
  constraint staff_tasks_source_assignment_len_chk
    check (source_assignment_label is null or char_length(source_assignment_label) <= 250),
  constraint staff_tasks_notes_len_chk
    check (notes is null or char_length(notes) <= 2000),
  constraint staff_tasks_sort_chk
    check (sort_order >= 0)
);

create unique index if not exists staff_tasks_area_name_ci_uidx
  on public.staff_tasks (area_id, lower(btrim(name)));

create index if not exists staff_tasks_area_active_sort_idx
  on public.staff_tasks (area_id, is_active desc, sort_order, name);

create table if not exists public.staff_task_default_assignees (
  task_id uuid not null
    references public.staff_tasks(id)
    on delete cascade,
  user_id uuid not null
    references public.profiles(user_id)
    on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(user_id) on delete set null,
  primary key (task_id, user_id)
);

create index if not exists staff_task_default_assignees_user_idx
  on public.staff_task_default_assignees (user_id, task_id);

create or replace function public.staff_payroll_touch_updated_at()
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

drop trigger if exists staff_task_areas_touch_updated_at
  on public.staff_task_areas;
create trigger staff_task_areas_touch_updated_at
before update on public.staff_task_areas
for each row
execute function public.staff_payroll_touch_updated_at();

drop trigger if exists staff_tasks_touch_updated_at
  on public.staff_tasks;
create trigger staff_tasks_touch_updated_at
before update on public.staff_tasks
for each row
execute function public.staff_payroll_touch_updated_at();

alter table public.staff_task_areas enable row level security;
alter table public.staff_tasks enable row level security;
alter table public.staff_task_default_assignees enable row level security;

drop policy if exists "admin read staff task areas"
  on public.staff_task_areas;
create policy "admin read staff task areas"
  on public.staff_task_areas
  for select
  using (public.is_admin_or_super_admin(auth.uid()));

drop policy if exists "super admin insert staff task areas"
  on public.staff_task_areas;
create policy "super admin insert staff task areas"
  on public.staff_task_areas
  for insert
  with check (public.is_super_admin(auth.uid()));

drop policy if exists "super admin update staff task areas"
  on public.staff_task_areas;
create policy "super admin update staff task areas"
  on public.staff_task_areas
  for update
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

drop policy if exists "admin read staff tasks"
  on public.staff_tasks;
create policy "admin read staff tasks"
  on public.staff_tasks
  for select
  using (public.is_admin_or_super_admin(auth.uid()));

drop policy if exists "super admin insert staff tasks"
  on public.staff_tasks;
create policy "super admin insert staff tasks"
  on public.staff_tasks
  for insert
  with check (public.is_super_admin(auth.uid()));

drop policy if exists "super admin update staff tasks"
  on public.staff_tasks;
create policy "super admin update staff tasks"
  on public.staff_tasks
  for update
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

drop policy if exists "admin read staff task default assignees"
  on public.staff_task_default_assignees;
create policy "admin read staff task default assignees"
  on public.staff_task_default_assignees
  for select
  using (public.is_admin_or_super_admin(auth.uid()));

drop policy if exists "super admin insert staff task default assignees"
  on public.staff_task_default_assignees;
create policy "super admin insert staff task default assignees"
  on public.staff_task_default_assignees
  for insert
  with check (public.is_super_admin(auth.uid()));

drop policy if exists "super admin delete staff task default assignees"
  on public.staff_task_default_assignees;
create policy "super admin delete staff task default assignees"
  on public.staff_task_default_assignees
  for delete
  using (public.is_super_admin(auth.uid()));

revoke all on table public.staff_task_areas from authenticated;
revoke all on table public.staff_tasks from authenticated;
revoke all on table public.staff_task_default_assignees from authenticated;

grant select, insert, update on table public.staff_task_areas to authenticated;
grant select, insert, update on table public.staff_tasks to authenticated;
grant select, insert, delete on table public.staff_task_default_assignees to authenticated;

grant all on table public.staff_task_areas to service_role;
grant all on table public.staff_tasks to service_role;
grant all on table public.staff_task_default_assignees to service_role;

comment on table public.staff_task_areas is
  'Staff Payroll task catalog areas. Areas are deactivated instead of hard-deleted.';
comment on table public.staff_tasks is
  'Staff Payroll task catalog. Initial 59 ATOM tasks are seeded from the planning document; compensation importance starts neutral at Standard / 1.00.';
comment on table public.staff_task_default_assignees is
  'Optional default staff profile assignments for catalog tasks. Multiple default assignees are supported.';

insert into public.staff_task_areas (slug, name, sort_order)
values
  ('general-management', 'General Management', 10),
  ('finance', 'Finance', 20),
  ('member-administration', 'Member Administration', 30),
  ('member-communication', 'Member Communication', 40),
  ('schedule-management', 'Schedule Management', 50),
  ('coaches-staff', 'Coaches / Staff', 60),
  ('technical-direction', 'Technical Direction', 70),
  ('coaching', 'Coaching', 80),
  ('competition', 'Competition', 90),
  ('sales-prospects', 'Sales / Prospects', 100),
  ('marketing', 'Marketing', 110),
  ('atom-website-app', 'ATOM Website / App', 120),
  ('store-inventory', 'Store / Inventory', 130),
  ('facility-maintenance', 'Facility / Maintenance', 140),
  ('federation-external-administration', 'Federation / External Administration', 150),
  ('legal-corporate', 'Legal / Corporate', 160),
  ('reporting', 'Reporting', 170),
  ('development', 'Development', 180)
on conflict (slug) do nothing;

insert into public.staff_tasks (
  area_id,
  source_key,
  name,
  frequency_label,
  estimated_time_label,
  estimated_min_hours_per_week,
  estimated_max_hours_per_week,
  unit,
  importance_level,
  importance_multiplier,
  source_assignment_label,
  sort_order
)
select
  a.id,
  v.source_key,
  v.task_name,
  v.frequency_label,
  v.estimated_time_label,
  v.estimated_min_hours_per_week,
  v.estimated_max_hours_per_week,
  v.unit,
  v.importance_level,
  v.importance_multiplier,
  v.source_assignment_label,
  v.sort_order
from (
  values
    ('general-management', 'atom-task-01', 'Daily operational decisions', 'Daily', '3–5 h/week', 3, 5, 'hour', 'standard', 1.00, 'Sharaf', 10),
  ('general-management', 'atom-task-02', 'Academy planning and development', 'Weekly', '1–2 h/week', 1, 2, 'hour', 'standard', 1.00, 'Sharaf', 20),
  ('general-management', 'atom-task-03', 'Management / shareholder follow-up meetings', 'As needed', '~1 h/meeting', 0, 1, 'meeting', 'standard', 1.00, 'Sharaf', 30),
  ('finance', 'atom-task-04', 'Cash control / reconciliation', 'Daily', '1–2 h/week', 1, 2, 'hour', 'standard', 1.00, 'Sharaf', 40),
  ('finance', 'atom-task-05', 'Payment and membership control', '2–3×/week', '1–2 h/week', 1, 2, 'hour', 'standard', 1.00, 'Sharaf', 50),
  ('finance', 'atom-task-06', 'Banking, transfers, rent, suppliers', 'Weekly', '2–3 h/week', 2, 3, 'hour', 'standard', 1.00, 'Sharaf', 60),
  ('finance', 'atom-task-07', 'Coordination with accountant', 'Weekly / monthly', '1–2 h/week', 1, 2, 'hour', 'standard', 1.00, 'Sharaf', 70),
  ('finance', 'atom-task-08', 'Debt and receivables follow-up', 'Weekly', '~1 h/week', 1, 1, 'hour', 'standard', 1.00, 'Sharaf', 80),
  ('member-administration', 'atom-task-09', 'New memberships', 'Daily', '2–4 h/week', 2, 4, 'hour', 'standard', 1.00, 'Admin Staff', 90),
  ('member-administration', 'atom-task-10', 'Renewals / expirations', 'Weekly', '1–2 h/week', 1, 2, 'hour', 'standard', 1.00, 'Admin Staff', 100),
  ('member-administration', 'atom-task-11', 'Freezes, cancellations, refunds', 'As needed', '1–2 h/week', 1, 2, 'hour', 'standard', 1.00, 'Sharaf', 110),
  ('member-administration', 'atom-task-12', 'Family / guardian account management', 'As needed', '1–2 h/week', 1, 2, 'hour', 'standard', 1.00, 'Admin Staff', 120),
  ('member-administration', 'atom-task-13', 'Member issue resolution', 'Daily', '2–3 h/week', 2, 3, 'hour', 'standard', 1.00, 'Sharaf', 130),
  ('member-communication', 'atom-task-14', 'Adults / parents WhatsApp communication', 'Daily', '2–4 h/week', 2, 4, 'hour', 'standard', 1.00, 'Admin Staff', 140),
  ('member-communication', 'atom-task-15', 'Individual member requests', 'Daily', '1–2 h/week', 1, 2, 'hour', 'standard', 1.00, 'Admin Staff', 150),
  ('member-communication', 'atom-task-16', 'Schedule / event announcements', 'As needed', '0.5–1 h/week', 0.5, 1, 'hour', 'standard', 1.00, 'Sharaf', 160),
  ('schedule-management', 'atom-task-17', 'Create / update class schedule', 'Weekly', '1–2 h/week', 1, 2, 'hour', 'standard', 1.00, 'Sharaf', 170),
  ('schedule-management', 'atom-task-18', 'Coach absence / replacement management', 'As needed', '~1 h/week', 0.5, 1, 'hour', 'standard', 1.00, 'Sharaf', 180),
  ('schedule-management', 'atom-task-19', 'Mat and group allocation', 'Weekly', '0.5–1 h/week', 0.5, 1, 'hour', 'standard', 1.00, 'Sharaf', 190),
  ('coaches-staff', 'atom-task-20', 'Coach coordination', 'Weekly', '1–2 h/week', 1, 2, 'hour', 'standard', 1.00, 'Sharaf', 200),
  ('coaches-staff', 'atom-task-21', 'Staff meetings', 'Weekly / monthly', '0.5–1 h/week', 0.5, 1, 'meeting', 'standard', 1.00, 'Sharaf', 210),
  ('coaches-staff', 'atom-task-22', 'Attendance / punctuality / conduct follow-up', 'Weekly', '~1 h/week', 1, 1, 'hour', 'standard', 1.00, 'Sharaf / Shehab', 220),
  ('coaches-staff', 'atom-task-23', 'Recruitment / coach evaluation', 'As needed', 'Variable', 0, 0, 'task', 'standard', 1.00, 'Sharaf', 230),
  ('technical-direction', 'atom-task-24', 'Monthly technical themes', 'Monthly', '~1 h/month', 0.25, 0.25, 'task', 'standard', 1.00, 'Sharaf', 240),
  ('technical-direction', 'atom-task-25', 'Curriculum / programme planning', 'Weekly', '1–2 h/week', 1, 2, 'hour', 'standard', 1.00, 'Sharaf', 250),
  ('technical-direction', 'atom-task-26', 'Belt / level evaluation and promotions', 'Periodic', '1–3 h/event', 0, 0, 'event', 'standard', 1.00, 'Sharaf', 260),
  ('technical-direction', 'atom-task-27', 'Class quality supervision', 'Weekly', '1–2 h/week', 1, 2, 'hour', 'standard', 1.00, 'Sharaf / Shehab', 270),
  ('coaching', 'atom-task-28', 'Adult Beginners classes', 'According to schedule', '1.5 h/class', 0, 0, 'class', 'standard', 1.00, 'Shawki / Ammar', 280),
  ('coaching', 'atom-task-29', 'Adult Intermediate classes', 'According to schedule', '1.5 h/class', 0, 0, 'class', 'standard', 1.00, null, 290),
  ('coaching', 'atom-task-30', 'Kids Beginners classes', 'According to schedule', '1.5 h/class', 0, 0, 'class', 'standard', 1.00, 'Shehab', 300),
  ('coaching', 'atom-task-31', 'Kids Intermediate classes', 'According to schedule', '1.5 h/class', 0, 0, 'class', 'standard', 1.00, null, 310),
  ('coaching', 'atom-task-32', 'Wrestling / NoGi classes', 'According to schedule', '1–1.5 h/class', 0, 0, 'class', 'standard', 1.00, null, 320),
  ('competition', 'atom-task-33', 'Athlete selection', 'Before events', '1–2 h/event', 0, 0, 'event', 'standard', 1.00, 'Sharaf', 330),
  ('competition', 'atom-task-34', 'Technical preparation', 'Weekly', '2–4 h/week', 2, 4, 'hour', 'standard', 1.00, 'Sharaf', 340),
  ('competition', 'atom-task-35', 'Competition coaching', 'Event days', '4–12+ h/day', 0, 0, 'day', 'standard', 1.00, 'Sharaf', 350),
  ('competition', 'atom-task-36', 'Registration / categories / weight management', 'Before events', '1–3 h/event', 0, 0, 'event', 'standard', 1.00, 'Sharaf', 360),
  ('competition', 'atom-task-37', 'Communication with athletes / parents', 'Before events', '1–2 h/event', 0, 0, 'event', 'standard', 1.00, 'Sharaf', 370),
  ('sales-prospects', 'atom-task-38', 'Responding to prospects', 'Daily', '1–2 h/week', 1, 2, 'hour', 'standard', 1.00, 'Sharaf', 380),
  ('sales-prospects', 'atom-task-39', 'Trials / visitors', 'Daily', '1–2 h/week', 1, 2, 'hour', 'standard', 1.00, 'Admin Staff', 390),
  ('sales-prospects', 'atom-task-40', 'Trial-to-membership conversion', 'Weekly', '~1 h/week', 1, 1, 'hour', 'standard', 1.00, 'Admin Staff', 400),
  ('marketing', 'atom-task-41', 'Instagram / content / stories', 'Weekly', '2–4 h/week', 2, 4, 'hour', 'standard', 1.00, 'Admin Staff', 410),
  ('marketing', 'atom-task-42', 'Photos / videos', 'As needed', '1–3 h/week', 1, 3, 'hour', 'standard', 1.00, null, 420),
  ('marketing', 'atom-task-43', 'Google Business / reviews', 'Weekly', '~1 h/week', 1, 1, 'hour', 'standard', 1.00, 'Sharaf', 430),
  ('marketing', 'atom-task-44', 'Blog / SEO / website', 'Monthly', '1–3 h/month', 0.25, 0.75, 'hour', 'standard', 1.00, 'Sharaf', 440),
  ('atom-website-app', 'atom-task-45', 'Check information / schedule', 'Weekly', '~1 h/week', 1, 1, 'hour', 'standard', 1.00, 'Sharaf', 450),
  ('atom-website-app', 'atom-task-46', 'Bugs / development coordination', 'As needed', '1–3 h/week', 1, 3, 'hour', 'standard', 1.00, 'Sharaf', 460),
  ('atom-website-app', 'atom-task-47', 'Validation of new modules', 'By project', 'Variable', 0, 0, 'project', 'standard', 1.00, 'Sharaf', 470),
  ('store-inventory', 'atom-task-48', 'Stock control', 'Weekly', '~1 h/week', 1, 1, 'hour', 'standard', 1.00, 'Sharaf', 480),
  ('store-inventory', 'atom-task-49', 'Supplier orders', 'As needed', '~1 h/week', 0.5, 1, 'hour', 'standard', 1.00, 'Sharaf', 490),
  ('store-inventory', 'atom-task-50', 'Sales / debt / inventory follow-up', 'Weekly', '1–2 h/week', 1, 2, 'hour', 'standard', 1.00, 'Sharaf', 500),
  ('facility-maintenance', 'atom-task-51', 'Cleanliness / maintenance control', 'Daily', '1–2 h/week', 1, 2, 'hour', 'standard', 1.00, 'Ammar', 510),
  ('facility-maintenance', 'atom-task-52', 'Repairs / service providers', 'As needed', '1–2 h/week', 1, 2, 'hour', 'standard', 1.00, null, 520),
  ('facility-maintenance', 'atom-task-53', 'Mall relationship', 'As needed', '1–2 h/week', 1, 2, 'hour', 'standard', 1.00, 'Sharaf', 530),
  ('federation-external-administration', 'atom-task-54', 'Licences / registrations', 'Periodic', '1–3 h/event', 0, 0, 'event', 'standard', 1.00, 'Sharaf', 540),
  ('federation-external-administration', 'atom-task-55', 'Official documents', 'As needed', '1–2 h/week', 1, 2, 'hour', 'standard', 1.00, 'Sharaf', 550),
  ('legal-corporate', 'atom-task-56', 'Lawyer / contracts / documents', 'As needed', '1–3 h/week', 1, 3, 'hour', 'standard', 1.00, 'Sharaf', 560),
  ('legal-corporate', 'atom-task-57', 'Corporate compliance follow-up', 'Monthly', '~1 h/month', 0.25, 0.25, 'hour', 'standard', 1.00, 'Sharaf', 570),
  ('reporting', 'atom-task-58', 'Financial / operational report', 'Monthly / quarterly', '1–2 h/report', 0.25, 0.5, 'report', 'standard', 1.00, 'Sharaf', 580),
  ('development', 'atom-task-59', 'New projects / partnerships', 'As needed', '1–3 h/week', 1, 3, 'hour', 'standard', 1.00, 'Sharaf', 590)
) as v(
  area_slug,
  source_key,
  task_name,
  frequency_label,
  estimated_time_label,
  estimated_min_hours_per_week,
  estimated_max_hours_per_week,
  unit,
  importance_level,
  importance_multiplier,
  source_assignment_label,
  sort_order
)
join public.staff_task_areas a
  on a.slug = v.area_slug
on conflict (source_key) do nothing;

commit;
