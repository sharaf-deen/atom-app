-- Make member active badge logic more reliable and consistent across DB consumers.
--
-- Why:
-- - Existing MV logic required end_date for every active subscription.
-- - Session-based plans can be active with remaining sessions even when end_date is null.
-- - We want a single DB source of truth for "is active now".

create or replace function public.member_is_active_now(
  p_member_id uuid,
  p_as_of date default current_date
)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.subscriptions s
    where s.member_id = p_member_id
      and lower(coalesce(s.status, '')) = 'active'
      and (
        (
          (
            coalesce(s.subscription_type, 'time') = 'sessions'
            or coalesce(s.plan::text, '') = 'sessions'
          )
          and greatest(coalesce(s.sessions_total, 0) - coalesce(s.sessions_used, 0), 0) > 0
        )
        or
        (
          (
            coalesce(s.subscription_type, 'time') <> 'sessions'
            and coalesce(s.plan::text, '') <> 'sessions'
          )
          and s.end_date is not null
          and s.end_date >= p_as_of
          and not (
            s.frozen_until is not null
            and (
              (
                s.frozen_from is not null
                and p_as_of >= s.frozen_from
                and p_as_of < s.frozen_until
              )
              or (
                s.frozen_from is null
                and p_as_of < s.frozen_until
              )
            )
          )
        )
      )
  );
$$;

revoke all on function public.member_is_active_now(uuid, date) from anon, authenticated;
grant execute on function public.member_is_active_now(uuid, date) to service_role;

-- Rebuild the MV so it uses the new single source of truth.
drop view if exists public.members_with_activity;
drop materialized view if exists public.members_with_activity_mv;

create materialized view public.members_with_activity_mv as
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
  public.member_is_active_now(p.user_id) as is_active
from public.profiles p
where p.role = 'member'
with data;

create unique index if not exists members_with_activity_mv_user_id_ux
  on public.members_with_activity_mv(user_id);

create index if not exists members_with_activity_mv_member_id_idx
  on public.members_with_activity_mv(member_id);

create index if not exists members_with_activity_mv_email_lower_idx
  on public.members_with_activity_mv(lower(email));

create index if not exists members_with_activity_mv_name_lower_idx
  on public.members_with_activity_mv(
    lower(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
  );

create index if not exists members_with_activity_mv_is_active_idx
  on public.members_with_activity_mv (is_active);

create index if not exists members_with_activity_mv_is_active_created_at_idx
  on public.members_with_activity_mv (is_active, created_at desc);

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

revoke all on table public.members_with_activity_mv from anon, authenticated;
grant select on table public.members_with_activity_mv to service_role;

revoke all on table public.members_with_activity from anon, authenticated;
grant select on table public.members_with_activity to service_role;

revoke all on function public.members_activity_stats() from anon, authenticated;
grant execute on function public.members_activity_stats() to service_role;

-- Best effort refresh so current data uses the new logic immediately.
select public.refresh_members_with_activity_mv();
