-- Materialized view for members active / inactive (faster for /members UI)
--
-- Notes:
-- - This is intended for LISTING + STATS pages (acceptable to be a few minutes stale).
-- - Keep real-time checks (e.g., kiosk access) querying subscriptions directly.
--
-- Ref: Postgres requires a UNIQUE index for REFRESH ... CONCURRENTLY.

-- 1) Materialized view (cached snapshot)
create materialized view if not exists public.members_with_activity_mv as
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
where p.role = 'member'
with data;

-- 2) Indexes (required + nice-to-have)
-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY
create unique index if not exists members_with_activity_mv_user_id_ux
  on public.members_with_activity_mv(user_id);

-- Helpful for UI filters/search
create index if not exists members_with_activity_mv_member_id_idx
  on public.members_with_activity_mv(member_id);

create index if not exists members_with_activity_mv_email_lower_idx
  on public.members_with_activity_mv(lower(email));

create index if not exists members_with_activity_mv_name_lower_idx
  on public.members_with_activity_mv(
    lower(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
  );

-- 3) Keep the same interface for the app (view + stats RPC)
create or replace view public.members_with_activity as
select * from public.members_with_activity_mv;

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
  from public.members_with_activity_mv;
$$;

-- 4) Refresh function (safe fallback)
-- Use CONCURRENTLY when possible so SELECTs are not blocked.
create or replace function public.refresh_members_with_activity_mv()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    refresh materialized view concurrently public.members_with_activity_mv;
  exception when others then
    -- Fallback (blocks reads on the matview during refresh)
    refresh materialized view public.members_with_activity_mv;
  end;
end;
$$;

-- 5) Security: keep these server-only (Next uses service role key)
revoke all on materialized view public.members_with_activity_mv from anon, authenticated;
grant select on materialized view public.members_with_activity_mv to service_role;

revoke all on view public.members_with_activity from anon, authenticated;
grant select on view public.members_with_activity to service_role;

revoke all on function public.members_activity_stats() from anon, authenticated;
grant execute on function public.members_activity_stats() to service_role;

revoke all on function public.refresh_members_with_activity_mv() from anon, authenticated;
grant execute on function public.refresh_members_with_activity_mv() to service_role;

-- 6) Scheduling (recommended)
-- Enable Supabase Cron (pg_cron) in Dashboard: Integrations → Cron → Enable.
-- Then schedule a refresh every 5 minutes (SQL Editor):
--
--   select cron.schedule(
--     'refresh_members_with_activity_mv',
--     '*/5 * * * *',
--     $$select public.refresh_members_with_activity_mv();$$
--   );
--
-- To check jobs:
--   select * from cron.job;
-- To see last runs:
--   select * from cron.job_run_details order by start_time desc limit 20;
-- To delete:
--   select cron.unschedule('refresh_members_with_activity_mv');
