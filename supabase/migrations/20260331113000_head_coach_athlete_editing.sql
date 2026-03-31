begin;

alter table public.member_training_profiles
  add column if not exists stripes integer not null default 0,
  add column if not exists specialty text null check (specialty in ('kimono_only', 'nogi_only', 'both')),
  add column if not exists reference_coach_user_id uuid null references public.profiles(user_id) on delete set null;

update public.member_training_profiles
set stripes = coalesce(stripes, 0)
where stripes is null;

create index if not exists idx_member_training_profiles_reference_coach
  on public.member_training_profiles (reference_coach_user_id);

create table if not exists public.member_athlete_progress_events (
  id uuid primary key default gen_random_uuid(),
  member_user_id uuid not null references public.profiles(user_id) on delete cascade,
  event_type text not null check (event_type in ('profile_update', 'program_change', 'stripe_award', 'belt_promotion', 'competition_result', 'note')),
  effective_date date not null default current_date,
  previous_program_level text null check (previous_program_level in ('beginner', 'intermediate', 'advanced', 'competitor')),
  next_program_level text null check (next_program_level in ('beginner', 'intermediate', 'advanced', 'competitor')),
  previous_belt_code text null,
  next_belt_code text null,
  previous_stripes integer null,
  next_stripes integer null,
  notes text null,
  created_at timestamptz not null default timezone('utc', now()),
  created_by uuid null references public.profiles(user_id) on delete set null
);

create index if not exists idx_member_athlete_progress_events_member_date
  on public.member_athlete_progress_events (member_user_id, effective_date desc, created_at desc);

alter table public.member_athlete_progress_events enable row level security;

drop policy if exists member_athlete_progress_events_select_own on public.member_athlete_progress_events;
create policy member_athlete_progress_events_select_own
on public.member_athlete_progress_events
for select
using (auth.uid() = member_user_id);

drop view if exists public.head_coach_athlete_roster;

create view public.head_coach_athlete_roster as
with athlete_base as (
  select
    p.user_id,
    p.member_id,
    p.first_name,
    p.last_name,
    p.email,
    p.role,
    p.date_of_birth,
    p.created_at as profile_created_at,
    tp.program_level,
    coalesce(tp.stripes, 0) as stripes,
    tp.specialty,
    tp.notes as coach_note,
    tp.reference_coach_user_id,
    nullif(trim(concat(coalesce(rc.first_name, ''), ' ', coalesce(rc.last_name, ''))), '') as reference_coach_name
  from public.profiles p
  left join public.member_training_profiles tp on tp.member_user_id = p.user_id
  left join public.profiles rc on rc.user_id = tp.reference_coach_user_id
  where p.role in ('member', 'coach', 'assistant_coach', 'vip', 'champion')
),
attendance_rollup as (
  select
    a.member_id as user_id,
    count(*) filter (where a.date >= current_date - 29) as attendance_30d,
    count(*) filter (where a.date >= current_date - 89) as attendance_90d,
    count(*) filter (where a.date >= current_date - 179) as attendance_180d,
    max(a.date) as last_attended_at
  from public.attendance a
  group by a.member_id
),
latest_belt as (
  select distinct on (bp.member_user_id)
    bp.member_user_id as user_id,
    bp.belt_code as current_belt,
    bp.promoted_at as current_belt_promoted_at
  from public.member_belt_promotions bp
  order by bp.member_user_id, bp.promoted_at desc, bp.created_at desc
),
competition_rollup as (
  select
    cr.member_user_id as user_id,
    count(*) as competition_count,
    count(*) filter (where cr.result in ('gold', 'silver', 'bronze')) as podium_count,
    max(cr.competition_date) as latest_competition_date
  from public.member_competition_results cr
  group by cr.member_user_id
),
latest_competition as (
  select distinct on (cr.member_user_id)
    cr.member_user_id as user_id,
    cr.competition_name as latest_competition_name,
    cr.result as latest_result
  from public.member_competition_results cr
  order by cr.member_user_id, cr.competition_date desc, cr.created_at desc
)
select
  ab.user_id,
  ab.member_id,
  ab.first_name,
  ab.last_name,
  ab.email,
  ab.role,
  ab.date_of_birth,
  ab.profile_created_at,
  ab.program_level,
  ab.stripes,
  ab.specialty,
  ab.coach_note,
  ab.reference_coach_user_id,
  ab.reference_coach_name,
  coalesce(ar.attendance_30d, 0) as attendance_30d,
  coalesce(ar.attendance_90d, 0) as attendance_90d,
  coalesce(ar.attendance_180d, 0) as attendance_180d,
  ar.last_attended_at,
  lb.current_belt,
  lb.current_belt_promoted_at,
  coalesce(cr.competition_count, 0) as competition_count,
  coalesce(cr.podium_count, 0) as podium_count,
  cr.latest_competition_date,
  lc.latest_competition_name,
  lc.latest_result
from athlete_base ab
left join attendance_rollup ar on ar.user_id = ab.user_id
left join latest_belt lb on lb.user_id = ab.user_id
left join competition_rollup cr on cr.user_id = ab.user_id
left join latest_competition lc on lc.user_id = ab.user_id;

revoke all on table public.head_coach_athlete_roster from anon, authenticated;
grant select on table public.head_coach_athlete_roster to service_role;

commit;