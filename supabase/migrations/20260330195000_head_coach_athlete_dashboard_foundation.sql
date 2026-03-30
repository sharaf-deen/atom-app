begin;

alter table public.member_training_profiles
  add column if not exists stripes integer,
  add column if not exists specialty text,
  add column if not exists reference_coach_user_id uuid references public.profiles(user_id) on delete set null;

update public.member_training_profiles
set stripes = coalesce(stripes, 0)
where stripes is null;

alter table public.member_training_profiles
  alter column stripes set default 0,
  alter column stripes set not null;

alter table public.member_training_profiles
  drop constraint if exists member_training_profiles_stripes_check,
  add constraint member_training_profiles_stripes_check check (stripes between 0 and 4);

alter table public.member_training_profiles
  drop constraint if exists member_training_profiles_specialty_check,
  add constraint member_training_profiles_specialty_check check (
    specialty is null
    or specialty in ('kimono_only', 'nogi_only', 'both')
  );

create index if not exists idx_member_training_profiles_program_level_v2
  on public.member_training_profiles (program_level);

create index if not exists idx_member_training_profiles_specialty
  on public.member_training_profiles (specialty);

create index if not exists idx_member_training_profiles_reference_coach_user_id
  on public.member_training_profiles (reference_coach_user_id);

create index if not exists idx_attendance_member_id_date_desc
  on public.attendance (member_id, date desc);

create or replace view public.head_coach_athlete_roster as
select
  p.user_id,
  p.member_id,
  p.first_name,
  p.last_name,
  p.email,
  p.phone,
  p.role,
  p.date_of_birth,
  p.created_at,
  mtp.program_level,
  mtp.stripes,
  mtp.specialty,
  mtp.reference_coach_user_id,
  mtp.notes as athlete_notes,
  mtp.updated_at as athlete_profile_updated_at,
  belt.current_belt_code,
  belt.last_promoted_at,
  comp.competition_count,
  comp.podium_count,
  comp.latest_competition_name,
  comp.latest_competition_date,
  comp.latest_result
from public.profiles p
left join public.member_training_profiles mtp
  on mtp.member_user_id = p.user_id
left join lateral (
  select
    bp.belt_code as current_belt_code,
    bp.promoted_at as last_promoted_at
  from public.member_belt_promotions bp
  where bp.member_user_id = p.user_id
  order by bp.promoted_at desc, bp.created_at desc
  limit 1
) belt on true
left join lateral (
  select
    count(*)::int as competition_count,
    count(*) filter (where r.result in ('gold', 'silver', 'bronze'))::int as podium_count,
    (
      array_agg(r.competition_name order by r.competition_date desc, r.created_at desc)
    )[1] as latest_competition_name,
    max(r.competition_date) as latest_competition_date,
    (
      array_agg(r.result order by r.competition_date desc, r.created_at desc)
    )[1] as latest_result
  from public.member_competition_results r
  where r.member_user_id = p.user_id
) comp on true
where p.role in ('member', 'coach', 'assistant_coach', 'vip', 'champion');

revoke all on table public.head_coach_athlete_roster from anon, authenticated;
grant select on table public.head_coach_athlete_roster to service_role;

commit;
