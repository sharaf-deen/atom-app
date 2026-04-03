-- Freeze token system for subscriptions.
-- 1 month and sessions plans cannot be frozen.
-- 3m = 1 freeze, 6m = 2 freezes, 12m = 3 freezes.
-- Each freeze is limited to 30 days max.

create table if not exists public.subscription_freezes (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  freeze_from date not null,
  freeze_until date not null,
  days integer not null check (days >= 1 and days <= 30),
  created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(user_id) on delete set null,
  cleared_at timestamptz null,
  constraint subscription_freezes_range_check check (freeze_until > freeze_from)
);

create index if not exists idx_subscription_freezes_subscription_id
  on public.subscription_freezes(subscription_id, created_at desc);

create unique index if not exists uq_subscription_freezes_one_active_per_subscription
  on public.subscription_freezes(subscription_id)
  where cleared_at is null;

alter table public.subscription_freezes enable row level security;

-- Service role bypasses RLS; no public policies are required.

insert into public.subscription_freezes (subscription_id, freeze_from, freeze_until, days, created_by)
select
  s.id,
  coalesce(s.frozen_from, current_date)::date as freeze_from,
  s.frozen_until::date as freeze_until,
  greatest(1, least(30, (s.frozen_until::date - coalesce(s.frozen_from, current_date)::date)))::int as days,
  null
from public.subscriptions s
where s.frozen_until is not null
  and not exists (
    select 1
    from public.subscription_freezes sf
    where sf.subscription_id = s.id
      and sf.cleared_at is null
  );
