-- Structured Schedule Lot 2B — Recurring Training Sessions
-- Materializes active recurring Class Templates into dated calendar session instances.
-- The current member-facing Schedule remains on the legacy timetable in this lot.
-- Future template synchronization is intentionally limited to future rows that are still
-- scheduled + template_managed. Historical/completed/cancelled/exception-locked rows are preserved.

begin;

create table if not exists public.schedule_training_sessions (
  id uuid primary key default gen_random_uuid(),
  class_template_id uuid not null references public.schedule_class_templates(id) on delete restrict,
  session_date date not null,
  start_time time without time zone not null,
  end_time time without time zone null,

  -- Immutable/history-friendly snapshots of the recurring template as synchronized for this date.
  series_key_snapshot text not null,
  name_snapshot text not null,
  audience_snapshot text not null,
  age_min_snapshot smallint null,
  age_max_snapshot smallint null,
  level_snapshot text not null,
  activity_type_snapshot text not null,
  uniform_snapshot text not null default 'none',
  mat_snapshot text null,
  notes_snapshot text null,

  status text not null default 'scheduled',
  template_managed boolean not null default true,

  generated_by uuid null references auth.users(id) on delete set null,
  generated_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint schedule_training_sessions_name_length
    check (char_length(btrim(name_snapshot)) between 2 and 180),
  constraint schedule_training_sessions_audience_check
    check (audience_snapshot in ('kids_teens','adults','all')),
  constraint schedule_training_sessions_age_range_check
    check (
      (age_min_snapshot is null and age_max_snapshot is null)
      or (
        age_min_snapshot is not null
        and age_max_snapshot is not null
        and age_min_snapshot >= 0
        and age_max_snapshot <= 99
        and age_max_snapshot >= age_min_snapshot
      )
    ),
  constraint schedule_training_sessions_level_length
    check (char_length(btrim(level_snapshot)) between 2 and 100),
  constraint schedule_training_sessions_activity_check
    check (activity_type_snapshot in ('jiu_jitsu','competition','open_drills','open_mat','physical_preparation','wrestling','other')),
  constraint schedule_training_sessions_uniform_check
    check (uniform_snapshot in ('gi','nogi','gi_nogi','none')),
  constraint schedule_training_sessions_time_check
    check (end_time is null or end_time > start_time),
  constraint schedule_training_sessions_mat_length
    check (mat_snapshot is null or char_length(btrim(mat_snapshot)) between 1 and 80),
  constraint schedule_training_sessions_notes_length
    check (notes_snapshot is null or char_length(notes_snapshot) <= 2000),
  constraint schedule_training_sessions_status_check
    check (status in ('scheduled','completed','cancelled'))
);

create unique index if not exists schedule_training_sessions_template_date_uq
  on public.schedule_training_sessions (class_template_id, session_date);

create index if not exists schedule_training_sessions_date_time_idx
  on public.schedule_training_sessions (session_date, start_time, name_snapshot);

create index if not exists schedule_training_sessions_series_date_idx
  on public.schedule_training_sessions (series_key_snapshot, session_date, start_time);

create index if not exists schedule_training_sessions_status_date_idx
  on public.schedule_training_sessions (status, session_date);

alter table public.schedule_training_sessions enable row level security;

grant select, insert, update, delete on public.schedule_training_sessions to authenticated;

-- Coaching staff may read dated sessions for future Coach Operations linking.
-- Member/guardian access is intentionally NOT opened in Lot 2B; Lot 2C will define
-- the member-facing structured Schedule contract separately.
drop policy if exists schedule_training_sessions_read_coaching_staff on public.schedule_training_sessions;
create policy schedule_training_sessions_read_coaching_staff
on public.schedule_training_sessions
for select to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role::text = any (array['assistant_coach','coach','head_coach','super_admin']::text[])
  )
);

-- Only Head Coach / Super Admin may materialize or synchronize future session rows.
drop policy if exists schedule_training_sessions_insert_managers on public.schedule_training_sessions;
create policy schedule_training_sessions_insert_managers
on public.schedule_training_sessions
for insert to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role::text = any (array['head_coach','super_admin']::text[])
  )
);

drop policy if exists schedule_training_sessions_update_managers on public.schedule_training_sessions;
create policy schedule_training_sessions_update_managers
on public.schedule_training_sessions
for update to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role::text = any (array['head_coach','super_admin']::text[])
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role::text = any (array['head_coach','super_admin']::text[])
  )
);

-- DELETE is used only by the server sync flow to remove obsolete FUTURE
-- template-managed scheduled placeholders when a recurring template changes.
-- Historical/completed/cancelled/exception-locked rows are protected by API logic.
drop policy if exists schedule_training_sessions_delete_managers on public.schedule_training_sessions;
create policy schedule_training_sessions_delete_managers
on public.schedule_training_sessions
for delete to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role::text = any (array['head_coach','super_admin']::text[])
  )
);

commit;
