-- Structured Schedule Lot 2A — Class Templates Foundation
-- Introduces structured recurring class templates without changing the existing member Schedule page.
-- Initial seed follows the public website's "Weekly Schedule by Day" as reviewed on 2026-09-05.
-- Where the public group summary conflicts with the day-by-day timetable, the day-by-day timetable is used
-- and the discrepancy is retained as an internal note for later operational verification.

begin;

create table if not exists public.schedule_class_templates (
  id uuid primary key default gen_random_uuid(),
  series_key text not null,
  name text not null,
  audience text not null,
  age_min smallint null,
  age_max smallint null,
  level text not null,
  activity_type text not null,
  uniform text not null default 'none',
  day_of_week smallint not null,
  start_time time without time zone not null,
  end_time time without time zone null,
  mat text null,
  notes text null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  effective_from date not null default current_date,
  effective_until date null,
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_class_templates_series_key_check
    check (series_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint schedule_class_templates_name_length
    check (char_length(btrim(name)) between 2 and 180),
  constraint schedule_class_templates_audience_check
    check (audience in ('kids_teens','adults','all')),
  constraint schedule_class_templates_age_range_check
    check (
      (age_min is null and age_max is null)
      or (
        age_min is not null
        and age_max is not null
        and age_min >= 0
        and age_max <= 99
        and age_max >= age_min
      )
    ),
  constraint schedule_class_templates_level_length
    check (char_length(btrim(level)) between 2 and 100),
  constraint schedule_class_templates_activity_type_check
    check (activity_type in ('jiu_jitsu','competition','open_drills','open_mat','physical_preparation','wrestling','other')),
  constraint schedule_class_templates_uniform_check
    check (uniform in ('gi','nogi','gi_nogi','none')),
  constraint schedule_class_templates_day_check
    check (day_of_week between 0 and 6),
  constraint schedule_class_templates_time_check
    check (end_time is null or end_time > start_time),
  constraint schedule_class_templates_mat_length
    check (mat is null or char_length(btrim(mat)) between 1 and 80),
  constraint schedule_class_templates_notes_length
    check (notes is null or char_length(notes) <= 2000),
  constraint schedule_class_templates_effective_range_check
    check (effective_until is null or effective_until >= effective_from)
);

create index if not exists schedule_class_templates_active_day_time_idx
  on public.schedule_class_templates (is_active, day_of_week, start_time, sort_order);

create index if not exists schedule_class_templates_series_idx
  on public.schedule_class_templates (series_key, is_active, day_of_week, start_time);

create unique index if not exists schedule_class_templates_active_occurrence_uq
  on public.schedule_class_templates (series_key, day_of_week, start_time, coalesce(mat, ''))
  where is_active = true;

alter table public.schedule_class_templates enable row level security;

grant select, insert, update on public.schedule_class_templates to authenticated;
revoke delete on public.schedule_class_templates from authenticated;

-- Active templates are readable by authenticated app users for the future structured member Schedule.
-- Head Coach / Super Admin can also read inactive templates from the management page.
drop policy if exists schedule_class_templates_read_authenticated on public.schedule_class_templates;
create policy schedule_class_templates_read_authenticated
on public.schedule_class_templates
for select to authenticated
using (
  is_active = true
  or exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role::text = any (array['head_coach','super_admin']::text[])
  )
);

-- Only Head Coach / Super Admin can create recurring class templates.
drop policy if exists schedule_class_templates_insert_managers on public.schedule_class_templates;
create policy schedule_class_templates_insert_managers
on public.schedule_class_templates
for insert to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role::text = any (array['head_coach','super_admin']::text[])
  )
);

-- Only Head Coach / Super Admin can edit, archive or restore templates.
drop policy if exists schedule_class_templates_update_managers on public.schedule_class_templates;
create policy schedule_class_templates_update_managers
on public.schedule_class_templates
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

-- No authenticated DELETE policy by design. Templates are archived instead of deleted.

-- Seed: current public "Weekly Schedule by Day".
-- day_of_week: 0 Sunday ... 6 Saturday.
insert into public.schedule_class_templates
  (series_key, name, audience, age_min, age_max, level, activity_type, uniform, day_of_week, start_time, mat, notes, sort_order, effective_from)
values
  -- Sunday
  ('competition-kids', 'Competition Kids', 'kids_teens', null, null, 'Competition', 'competition', 'none', 0, '16:00', null,
    'Seeded from public Weekly Schedule by Day. Public group summary lists Competition Team on Tue/Wed/Thu/Sat/Sun, while the day-by-day section lists Sunday through Thursday.', 100, '2026-09-05'),
  ('kids-6-9-beginners', 'Kids 6–9 Beginners', 'kids_teens', 6, 9, 'Beginners', 'jiu_jitsu', 'gi', 0, '18:00', 'Mat 1', null, 110, '2026-09-05'),
  ('teens-10-14-beginners', 'Teens 10–14 Beginners', 'kids_teens', 10, 14, 'Beginners', 'jiu_jitsu', 'gi', 0, '18:00', 'Mat 2', null, 120, '2026-09-05'),
  ('adults-open-drills', 'Adults Open Drills', 'adults', null, null, 'All Levels', 'open_drills', 'gi_nogi', 0, '14:00', null, null, 90, '2026-09-05'),
  ('adults-intermediate-advanced', 'Adults Intermediate / Advanced', 'adults', null, null, 'Intermediate / Advanced', 'jiu_jitsu', 'gi', 0, '19:30', 'Mat 1', null, 130, '2026-09-05'),
  ('adults-beginners', 'Adults Beginners', 'adults', null, null, 'Beginners', 'jiu_jitsu', 'nogi', 0, '19:30', 'Mat 2', null, 140, '2026-09-05'),
  ('physical-preparation', 'Physical Preparation', 'adults', null, null, 'All Levels', 'physical_preparation', 'none', 0, '21:00', null, null, 150, '2026-09-05'),

  -- Monday
  ('competition-kids', 'Competition Kids', 'kids_teens', null, null, 'Competition', 'competition', 'none', 1, '16:00', null,
    'Seeded from public Weekly Schedule by Day. Public group summary does not list Monday and instead lists Saturday.', 200, '2026-09-05'),
  ('kids-6-9-intermediate', 'Kids 6–9 Intermediate', 'kids_teens', 6, 9, 'Intermediate', 'jiu_jitsu', 'gi', 1, '18:00', 'Mat 1', null, 210, '2026-09-05'),
  ('teens-10-14-intermediate', 'Teens 10–14 Intermediate', 'kids_teens', 10, 14, 'Intermediate', 'jiu_jitsu', 'gi', 1, '18:00', 'Mat 2', null, 220, '2026-09-05'),
  ('adults-intermediate-advanced', 'Adults Intermediate / Advanced', 'adults', null, null, 'Intermediate / Advanced', 'jiu_jitsu', 'nogi', 1, '19:30', 'Mat 1',
    'Weekly Schedule by Day used as seed authority. Public Adults summary labels Monday as NoGi/Wrestling.', 230, '2026-09-05'),
  ('adults-beginners', 'Adults Beginners', 'adults', null, null, 'Beginners', 'jiu_jitsu', 'gi', 1, '19:30', 'Mat 2',
    'Weekly Schedule by Day used as seed authority. Public Adults summary labels Monday as NoGi/Wrestling.', 240, '2026-09-05'),

  -- Tuesday
  ('competition-kids', 'Competition Kids', 'kids_teens', null, null, 'Competition', 'competition', 'none', 2, '16:00', null, null, 300, '2026-09-05'),
  ('kids-6-9-beginners', 'Kids 6–9 Beginners', 'kids_teens', 6, 9, 'Beginners', 'jiu_jitsu', 'gi', 2, '18:00', 'Mat 1', null, 310, '2026-09-05'),
  ('teens-10-14-beginners', 'Teens 10–14 Beginners', 'kids_teens', 10, 14, 'Beginners', 'jiu_jitsu', 'gi', 2, '18:00', 'Mat 2', null, 320, '2026-09-05'),
  ('adults-open-drills', 'Adults Open Drills', 'adults', null, null, 'All Levels', 'open_drills', 'gi_nogi', 2, '14:00', null, null, 290, '2026-09-05'),
  ('adults-intermediate-advanced', 'Adults Intermediate / Advanced', 'adults', null, null, 'Intermediate / Advanced', 'jiu_jitsu', 'gi', 2, '19:30', 'Mat 1', null, 330, '2026-09-05'),
  ('adults-beginners', 'Adults Beginners', 'adults', null, null, 'Beginners', 'jiu_jitsu', 'nogi', 2, '19:30', 'Mat 2', null, 340, '2026-09-05'),
  ('physical-preparation', 'Physical Preparation', 'adults', null, null, 'All Levels', 'physical_preparation', 'none', 2, '21:00', null, null, 350, '2026-09-05'),

  -- Wednesday
  ('competition-kids', 'Competition Kids', 'kids_teens', null, null, 'Competition', 'competition', 'none', 3, '16:00', null, null, 400, '2026-09-05'),
  ('baby-3-5-group-a', 'Baby 3–5 years · Group A', 'kids_teens', 3, 5, 'Beginners', 'jiu_jitsu', 'gi', 3, '17:00', 'Mat 1', null, 410, '2026-09-05'),
  ('kids-6-9-intermediate', 'Kids 6–9 Intermediate', 'kids_teens', 6, 9, 'Intermediate', 'jiu_jitsu', 'gi', 3, '18:00', 'Mat 1', null, 420, '2026-09-05'),
  ('teens-10-14-intermediate', 'Teens 10–14 Intermediate', 'kids_teens', 10, 14, 'Intermediate', 'jiu_jitsu', 'gi', 3, '18:00', 'Mat 2', null, 430, '2026-09-05'),
  ('adults-open-drills', 'Adults Open Drills', 'adults', null, null, 'All Levels', 'open_drills', 'gi_nogi', 3, '14:00', null, null, 390, '2026-09-05'),
  ('masters-30-plus', 'Masters 30+', 'adults', 30, 99, 'All Levels', 'jiu_jitsu', 'gi', 3, '19:30', null, null, 440, '2026-09-05'),
  ('adults-open-mat', 'Adults Open Mat', 'adults', null, null, 'All Levels', 'open_mat', 'nogi', 3, '21:00', null, null, 450, '2026-09-05'),

  -- Thursday
  ('competition-kids', 'Competition Kids', 'kids_teens', null, null, 'Competition', 'competition', 'none', 4, '16:00', null, null, 500, '2026-09-05'),
  ('kids-6-9-beginners', 'Kids 6–9 Beginners', 'kids_teens', 6, 9, 'Beginners', 'jiu_jitsu', 'gi', 4, '18:00', 'Mat 1', null, 510, '2026-09-05'),
  ('teens-10-14-beginners', 'Teens 10–14 Beginners', 'kids_teens', 10, 14, 'Beginners', 'jiu_jitsu', 'gi', 4, '18:00', 'Mat 2', null, 520, '2026-09-05'),
  ('adults-open-drills', 'Adults Open Drills', 'adults', null, null, 'All Levels', 'open_drills', 'gi_nogi', 4, '14:00', null, null, 490, '2026-09-05'),
  ('adults-intermediate-advanced', 'Adults Intermediate / Advanced', 'adults', null, null, 'Intermediate / Advanced', 'jiu_jitsu', 'nogi', 4, '19:30', 'Mat 1', null, 530, '2026-09-05'),
  ('adults-beginners', 'Adults Beginners', 'adults', null, null, 'Beginners', 'jiu_jitsu', 'gi', 4, '19:30', 'Mat 2', null, 540, '2026-09-05'),
  ('adults-open-mat', 'Adults Open Mat', 'adults', null, null, 'All Levels', 'open_mat', 'gi', 4, '21:00', null, null, 550, '2026-09-05'),

  -- Saturday
  ('baby-3-5-group-a', 'Baby 3–5 years · Group A', 'kids_teens', 3, 5, 'Beginners', 'jiu_jitsu', 'gi', 6, '13:00', 'Mat 2', null, 610, '2026-09-05'),
  ('kids-6-9-intermediate', 'Kids 6–9 Intermediate', 'kids_teens', 6, 9, 'Intermediate', 'jiu_jitsu', 'nogi', 6, '14:30', 'Mat 1',
    'Weekly Schedule by Day used as seed authority. Public group summary lists Saturday 6:00 PM · Gi.', 620, '2026-09-05'),
  ('teens-10-14-intermediate', 'Teens 10–14 Intermediate', 'kids_teens', 10, 14, 'Intermediate', 'jiu_jitsu', 'nogi', 6, '14:30', 'Mat 2',
    'Weekly Schedule by Day used as seed authority. Public group summary lists Saturday 2:30 PM · Gi.', 630, '2026-09-05'),
  ('kids-6-9-open-mat', 'Kids 6–9 Open Mat', 'kids_teens', 6, 9, 'All Levels', 'open_mat', 'none', 6, '16:00', 'Mat 1', null, 640, '2026-09-05'),
  ('kids-10-15-open-mat', 'Kids 10–15 Open Mat', 'kids_teens', 10, 15, 'All Levels', 'open_mat', 'none', 6, '16:00', 'Mat 2', null, 650, '2026-09-05'),
  ('adults-open-mat', 'Adults Open Mat', 'adults', null, null, 'All Levels', 'open_mat', 'gi', 6, '18:00', null, null, 660, '2026-09-05'),
  ('adults-intermediate-advanced', 'Adults Intermediate / Advanced', 'adults', null, null, 'Intermediate / Advanced', 'jiu_jitsu', 'nogi', 6, '19:30', 'Mat 1', null, 670, '2026-09-05'),
  ('adults-beginners', 'Adults Beginners', 'adults', null, null, 'Beginners', 'jiu_jitsu', 'gi', 6, '19:30', 'Mat 2', null, 680, '2026-09-05')
on conflict do nothing;

comment on table public.schedule_class_templates is
  'Structured Schedule: recurring class templates. Lot 2A foundation only; dated sessions are introduced in a later lot.';

comment on column public.schedule_class_templates.series_key is
  'Stable logical class/group key shared by recurring weekly occurrences of the same class.';

comment on column public.schedule_class_templates.day_of_week is
  'Recurring weekday using 0=Sunday through 6=Saturday.';

comment on column public.schedule_class_templates.effective_from is
  'First calendar date from which this recurring template is considered effective. Dated session generation is out of scope for Lot 2A.';

commit;
