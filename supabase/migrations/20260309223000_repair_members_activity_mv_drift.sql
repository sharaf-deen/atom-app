-- Repair migration for members activity MV drift
-- Safe to run on environments where the matview/function already exist.

-- 0) Helper index for active subscription checks
create index if not exists idx_subscriptions_active_member_end
  on public.subscriptions (member_id, end_date)
  where status = 'active';

-- 1) Ensure the materialized view exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_matviews
    WHERE schemaname = 'public'
      AND matviewname = 'members_with_activity_mv'
  ) THEN
    EXECUTE $mv$
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
        exists (
          select 1
          from public.subscriptions s
          where s.member_id = p.user_id
            and s.status = 'active'
            and s.end_date is not null
            and s.end_date >= current_date
            and (
              s.subscription_type <> 'time'
              or not (
                s.frozen_until is not null
                and (
                  (s.frozen_from is not null and current_date >= s.frozen_from and current_date < s.frozen_until)
                  or (s.frozen_from is null and current_date < s.frozen_until)
                )
              )
            )
        ) as is_active
      from public.profiles p
      where p.role = 'member'
      with data
    $mv$;
  END IF;
END $$;

-- 2) Ensure indexes exist
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

-- 3) Ensure compatibility view + stats function exist
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

-- 4) Intelligent refresh state + marker trigger function
create table if not exists public.mv_refresh_state (
  mv_name text primary key,
  dirty boolean not null default true,
  last_change timestamptz null,
  last_refresh timestamptz null
);

create or replace function public.mark_members_with_activity_mv_dirty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.mv_refresh_state (mv_name, dirty, last_change)
  values ('members_with_activity_mv', true, now())
  on conflict (mv_name)
  do update set dirty = true, last_change = excluded.last_change;
  return null;
end;
$$;

-- 5) Replace refresh function with boolean return (intelligent refresh)
drop function if exists public.refresh_members_with_activity_mv();

create or replace function public.refresh_members_with_activity_mv()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dirty boolean;
begin
  insert into public.mv_refresh_state (mv_name, dirty)
  values ('members_with_activity_mv', true)
  on conflict (mv_name) do nothing;

  select dirty into v_dirty
  from public.mv_refresh_state
  where mv_name = 'members_with_activity_mv';

  if v_dirty is distinct from true then
    return false;
  end if;

  begin
    refresh materialized view public.members_with_activity_mv;

    update public.mv_refresh_state
      set dirty = false,
          last_refresh = now()
    where mv_name = 'members_with_activity_mv';

    return true;
  exception when others then
    update public.mv_refresh_state
      set dirty = true
    where mv_name = 'members_with_activity_mv';
    raise;
  end;
end;
$$;

-- 6) Ensure triggers exist
DROP TRIGGER IF EXISTS trg_members_mv_dirty_profiles ON public.profiles;
CREATE TRIGGER trg_members_mv_dirty_profiles
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.profiles
FOR EACH STATEMENT EXECUTE FUNCTION public.mark_members_with_activity_mv_dirty();

DROP TRIGGER IF EXISTS trg_members_mv_dirty_subscriptions ON public.subscriptions;
CREATE TRIGGER trg_members_mv_dirty_subscriptions
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.subscriptions
FOR EACH STATEMENT EXECUTE FUNCTION public.mark_members_with_activity_mv_dirty();

-- 7) Security / grants
revoke all on table public.members_with_activity_mv from anon, authenticated;
grant select on table public.members_with_activity_mv to service_role;

revoke all on table public.members_with_activity from anon, authenticated;
grant select on table public.members_with_activity to service_role;

revoke all on table public.mv_refresh_state from anon, authenticated;
grant select, insert, update, delete on table public.mv_refresh_state to service_role;

revoke all on function public.members_activity_stats() from anon, authenticated;
grant execute on function public.members_activity_stats() to service_role;

revoke all on function public.mark_members_with_activity_mv_dirty() from anon, authenticated;
grant execute on function public.mark_members_with_activity_mv_dirty() to service_role;

revoke all on function public.refresh_members_with_activity_mv() from anon, authenticated;
grant execute on function public.refresh_members_with_activity_mv() to service_role;

-- 8) Seed refresh state and refresh once so the snapshot is immediately usable
insert into public.mv_refresh_state (mv_name, dirty, last_change)
values ('members_with_activity_mv', true, now())
on conflict (mv_name)
do update set dirty = true, last_change = excluded.last_change;

select public.refresh_members_with_activity_mv();
