-- Members activity (active / inactive) computed in Postgres

-- Ensure newer freeze model is supported (safe if already exists)
alter table if exists public.subscriptions
  add column if not exists frozen_from date;

-- Helpful partial index for "is active now" checks
create index if not exists idx_subscriptions_active_member_end
  on public.subscriptions (member_id, end_date)
  where status = 'active';

-- View: members (profiles.role = 'member') enriched with computed is_active
-- Logic mirrors app code:
-- - A member is active if there exists at least 1 subscription with:
--   - status = 'active'
--   - end_date >= current_date
--   - and if subscription_type = 'time', it must NOT be frozen right now
create or replace view public.members_with_activity as
select
  p.user_id,
  p.email,
  p.first_name,
  p.last_name,
  p.phone,
  p.role,
  p.created_at,
  p.member_id,
  p.date_of_birth,
  exists (
    select 1
    from public.subscriptions s
    where s.member_id = p.user_id
      and s.status = 'active'
      and s.end_date is not null
      and s.end_date >= current_date
      and (
        -- Freezing only applies to time subscriptions
        s.subscription_type <> 'time'
        or not (
          s.frozen_until is not null
          and (
            -- If frozen_from exists: frozen_from <= today < frozen_until
            (s.frozen_from is not null and current_date >= s.frozen_from and current_date < s.frozen_until)
            -- Legacy: if only frozen_until exists: today < frozen_until
            or (s.frozen_from is null and current_date < s.frozen_until)
          )
        )
      )
  ) as is_active
from public.profiles p
where p.role = 'member';

-- RPC: stats for members page cards
create or replace function public.members_activity_stats()
returns table(
  total bigint,
  active bigint,
  inactive bigint
)
language sql
stable
as $$
  select
    count(*) as total,
    count(*) filter (where is_active) as active,
    count(*) filter (where not is_active) as inactive
  from public.members_with_activity;
$$;

-- Security: keep these admin-only (Next uses service role key)
revoke all on table public.members_with_activity from anon, authenticated;
grant select on table public.members_with_activity to service_role;

revoke all on function public.members_activity_stats() from anon, authenticated;
grant execute on function public.members_activity_stats() to service_role;
