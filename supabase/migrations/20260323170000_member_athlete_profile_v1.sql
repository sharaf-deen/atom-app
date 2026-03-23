begin;

create table if not exists public.member_training_profiles (
  member_user_id uuid primary key references public.profiles(user_id) on delete cascade,
  program_level text null check (program_level in ('beginner', 'intermediate', 'advanced', 'competitor')),
  notes text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  updated_by uuid null references public.profiles(user_id) on delete set null
);

create table if not exists public.member_belt_promotions (
  id uuid primary key default gen_random_uuid(),
  member_user_id uuid not null references public.profiles(user_id) on delete cascade,
  belt_code text not null,
  promoted_at date not null,
  certificate_path text null,
  notes text null,
  created_at timestamp with time zone not null default now(),
  created_by uuid null references public.profiles(user_id) on delete set null
);

create table if not exists public.member_competition_results (
  id uuid primary key default gen_random_uuid(),
  member_user_id uuid not null references public.profiles(user_id) on delete cascade,
  competition_name text not null,
  competition_date date not null,
  division text null,
  category text null,
  result text not null check (result in ('gold', 'silver', 'bronze', 'other')),
  notes text null,
  created_at timestamp with time zone not null default now(),
  created_by uuid null references public.profiles(user_id) on delete set null
);

create index if not exists idx_member_training_profiles_updated_at on public.member_training_profiles (updated_at desc);
create index if not exists idx_member_belt_promotions_member_user_id on public.member_belt_promotions (member_user_id, promoted_at desc);
create index if not exists idx_member_competition_results_member_user_id on public.member_competition_results (member_user_id, competition_date desc);

alter table public.member_training_profiles enable row level security;
alter table public.member_belt_promotions enable row level security;
alter table public.member_competition_results enable row level security;

drop policy if exists member_training_profiles_select_own on public.member_training_profiles;
create policy member_training_profiles_select_own
on public.member_training_profiles
for select
using (auth.uid() = member_user_id);

drop policy if exists member_belt_promotions_select_own on public.member_belt_promotions;
create policy member_belt_promotions_select_own
on public.member_belt_promotions
for select
using (auth.uid() = member_user_id);

drop policy if exists member_competition_results_select_own on public.member_competition_results;
create policy member_competition_results_select_own
on public.member_competition_results
for select
using (auth.uid() = member_user_id);

drop trigger if exists trg_member_training_profiles_updated_at on public.member_training_profiles;
create trigger trg_member_training_profiles_updated_at
before update on public.member_training_profiles
for each row
execute function public.set_updated_at();

commit;
