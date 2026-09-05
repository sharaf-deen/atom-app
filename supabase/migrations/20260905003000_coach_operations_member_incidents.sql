-- Coach Operations Lot 1E — Member Incidents
-- Internal coaching incident register linked to members and optionally Training Session Logs.
-- Members and family guardians receive no read access to these records.

begin;

create table if not exists public.coach_member_incidents (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(user_id) on delete restrict,
  member_name_snapshot text not null,
  member_code_snapshot text null,
  training_log_id uuid null references public.coach_training_session_logs(id) on delete set null,
  training_group_snapshot text null,
  training_date_snapshot date null,
  category text not null,
  severity text not null,
  description text not null,
  status text not null default 'open',
  reported_by uuid null references auth.users(id) on delete set null,
  reporter_name_snapshot text not null,
  reporter_role_snapshot text not null,
  reported_at timestamptz not null default now(),
  resolved_by uuid null references auth.users(id) on delete set null,
  resolved_at timestamptz null,
  resolution_note text null,
  reopened_by uuid null references auth.users(id) on delete set null,
  reopened_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_member_incidents_category_check
    check (category in ('behaviour','safety','injury','repeated_lateness','disrespect','other')),
  constraint coach_member_incidents_severity_check
    check (severity in ('low','medium','high')),
  constraint coach_member_incidents_status_check
    check (status in ('open','resolved')),
  constraint coach_member_incidents_member_name_length
    check (char_length(btrim(member_name_snapshot)) between 2 and 180),
  constraint coach_member_incidents_description_length
    check (char_length(btrim(description)) between 5 and 3000),
  constraint coach_member_incidents_reporter_name_length
    check (char_length(btrim(reporter_name_snapshot)) between 2 and 180),
  constraint coach_member_incidents_resolution_note_length
    check (resolution_note is null or char_length(resolution_note) <= 2000)
);

create index if not exists coach_member_incidents_member_idx
  on public.coach_member_incidents (member_id, reported_at desc);

create index if not exists coach_member_incidents_training_log_idx
  on public.coach_member_incidents (training_log_id, reported_at desc)
  where training_log_id is not null;

create index if not exists coach_member_incidents_status_idx
  on public.coach_member_incidents (status, severity, reported_at desc);

create index if not exists coach_member_incidents_reporter_idx
  on public.coach_member_incidents (reported_by, reported_at desc);

alter table public.coach_member_incidents enable row level security;

grant select, insert, update on public.coach_member_incidents to authenticated;
revoke delete on public.coach_member_incidents from authenticated;

-- Coaching staff may read internal incidents. Admin has read-only visibility from member administration.
drop policy if exists coach_member_incidents_read_internal_staff on public.coach_member_incidents;
create policy coach_member_incidents_read_internal_staff
on public.coach_member_incidents
for select to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role::text = any (
        array['assistant_coach','coach','head_coach','admin','super_admin']::text[]
      )
  )
);

-- Coaching staff can report an incident only as themselves.
drop policy if exists coach_member_incidents_insert_coaching_staff on public.coach_member_incidents;
create policy coach_member_incidents_insert_coaching_staff
on public.coach_member_incidents
for insert to authenticated
with check (
  reported_by = auth.uid()
  and status = 'open'
  and resolved_by is null
  and resolved_at is null
  and reopened_by is null
  and reopened_at is null
  and exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role::text = any (
        array['assistant_coach','coach','head_coach','super_admin']::text[]
      )
  )
);

-- Only Head Coach / Super Admin can resolve or reopen incidents.
drop policy if exists coach_member_incidents_update_managers on public.coach_member_incidents;
create policy coach_member_incidents_update_managers
on public.coach_member_incidents
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

comment on table public.coach_member_incidents is
  'Coach Operations: internal member incidents reported by coaching staff. Hidden from members and family guardians by RLS.';

commit;
