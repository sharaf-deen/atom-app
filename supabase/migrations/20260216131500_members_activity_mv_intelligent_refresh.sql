-- Intelligent refresh for members_with_activity_mv
-- Idea: triggers mark MV as "dirty" when profiles/subscriptions change.
-- Cron can keep calling public.refresh_members_with_activity_mv(); it will skip when not dirty.

create table if not exists public.mv_refresh_state (
  mv_name text primary key,
  dirty boolean not null default true,
  last_change timestamptz null,
  last_refresh timestamptz null
);

-- Lock down the state table (service_role + postgres only)
revoke all on table public.mv_refresh_state from anon, authenticated;
grant select, insert, update, delete on table public.mv_refresh_state to service_role;

-- Trigger helper to mark the MV as dirty (statement-level triggers)
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

revoke all on function public.mark_members_with_activity_mv_dirty() from anon, authenticated;
grant execute on function public.mark_members_with_activity_mv_dirty() to service_role;

-- Replace refresh function: refresh only when dirty
-- NOTE: Postgres cannot change a function return type with CREATE OR REPLACE.
-- We drop the existing function first to allow changing/setting the return type.
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
  -- Ensure state row exists
  insert into public.mv_refresh_state (mv_name, dirty)
  values ('members_with_activity_mv', true)
  on conflict (mv_name) do nothing;

  select dirty into v_dirty
  from public.mv_refresh_state
  where mv_name = 'members_with_activity_mv';

  if v_dirty is distinct from true then
    return false; -- skipped
  end if;

  begin
    -- NOTE: using non-CONCURRENT refresh to keep it callable from function + cron.
    refresh materialized view public.members_with_activity_mv;

    update public.mv_refresh_state
      set dirty = false,
          last_refresh = now()
    where mv_name = 'members_with_activity_mv';

    return true; -- refreshed
  exception when others then
    -- keep dirty=true so next run will retry
    update public.mv_refresh_state
      set dirty = true
    where mv_name = 'members_with_activity_mv';
    raise;
  end;
end;
$$;

revoke all on function public.refresh_members_with_activity_mv() from anon, authenticated;
grant execute on function public.refresh_members_with_activity_mv() to service_role;

-- Statement-level triggers (lightweight)
drop trigger if exists trg_members_mv_dirty_profiles on public.profiles;
create trigger trg_members_mv_dirty_profiles
after insert or update or delete or truncate on public.profiles
for each statement execute function public.mark_members_with_activity_mv_dirty();

drop trigger if exists trg_members_mv_dirty_subscriptions on public.subscriptions;
create trigger trg_members_mv_dirty_subscriptions
after insert or update or delete or truncate on public.subscriptions
for each statement execute function public.mark_members_with_activity_mv_dirty();

-- Optional: initial state (dirty=false) if MV exists & already accurate.
-- Leave as dirty=true by default so first cron run refreshes.
