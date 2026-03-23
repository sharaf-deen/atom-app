begin;

alter table public.member_competition_results
  add column if not exists updated_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_by uuid null references public.profiles(user_id) on delete set null;

update public.member_competition_results
set updated_at = coalesce(updated_at, created_at, timezone('utc', now()))
where updated_at is null;

create index if not exists idx_member_competition_results_updated_at
  on public.member_competition_results (updated_at desc);

drop trigger if exists trg_member_competition_results_updated_at on public.member_competition_results;
create trigger trg_member_competition_results_updated_at
before update on public.member_competition_results
for each row
execute function public.set_updated_at();

alter table public.member_belt_promotions
  add column if not exists updated_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_by uuid null references auth.users(id) on delete set null;

update public.member_belt_promotions
set updated_at = coalesce(updated_at, created_at, timezone('utc', now()))
where updated_at is null;

create index if not exists idx_member_belt_promotions_member_user_updated_at
  on public.member_belt_promotions (member_user_id, updated_at desc);

drop trigger if exists trg_member_belt_promotions_updated_at on public.member_belt_promotions;
create trigger trg_member_belt_promotions_updated_at
before update on public.member_belt_promotions
for each row
execute function public.set_updated_at();

commit;
