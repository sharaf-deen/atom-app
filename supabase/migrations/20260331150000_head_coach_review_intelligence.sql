begin;

create table if not exists public.member_athlete_review_actions (
  id uuid primary key default gen_random_uuid(),
  member_user_id uuid not null references public.profiles(user_id) on delete cascade,
  review_lane text not null check (review_lane in ('beginner_cycle', 'intermediate_stripe', 'intermediate_belt', 'advanced_review', 'competitor_review', 'kimono_blocked', 'profile_incomplete')),
  recommendation_status text not null check (recommendation_status in ('due', 'review', 'watch', 'blocked')),
  action_status text not null check (action_status in ('pending', 'reviewed', 'deferred', 'approved', 'hold')),
  action_date date not null default current_date,
  snoozed_until date null,
  notes text null,
  created_at timestamptz not null default timezone('utc', now()),
  created_by uuid null references public.profiles(user_id) on delete set null
);

create index if not exists idx_member_athlete_review_actions_member_date
  on public.member_athlete_review_actions (member_user_id, action_date desc, created_at desc);

create index if not exists idx_member_athlete_review_actions_lane_status
  on public.member_athlete_review_actions (review_lane, action_status);

alter table public.member_athlete_review_actions enable row level security;

drop policy if exists member_athlete_review_actions_select_own on public.member_athlete_review_actions;
create policy member_athlete_review_actions_select_own
on public.member_athlete_review_actions
for select
using (auth.uid() = member_user_id);

drop view if exists public.head_coach_latest_review_action;

create view public.head_coach_latest_review_action as
select distinct on (ra.member_user_id)
  ra.member_user_id,
  ra.review_lane,
  ra.recommendation_status,
  ra.action_status,
  ra.action_date,
  ra.snoozed_until,
  ra.notes,
  ra.created_at,
  ra.created_by
from public.member_athlete_review_actions ra
order by ra.member_user_id, ra.action_date desc, ra.created_at desc;

revoke all on table public.head_coach_latest_review_action from anon, authenticated;
grant select on table public.head_coach_latest_review_action to service_role;

commit;
