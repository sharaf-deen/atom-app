-- Fix wrapper signature for search_members to match the current implementation.
-- IMPORTANT: CREATE OR REPLACE cannot change return type, so we DROP then CREATE.
-- This prevents errors during db reset:
--   "cannot change return type of existing function"
-- And runtime errors:
--   "Returned type timestamptz does not match expected type boolean in column 8"

do $$
begin
  -- Only run if the hardened wrapper pattern exists.
  if to_regprocedure('public.search_members_impl(text,text,integer,integer)') is null then
    return;
  end if;

  -- Drop the wrapper so we can recreate it with the correct RETURNS TABLE.
  execute 'drop function if exists public.search_members(text,text,integer,integer)';
end $$;

create function public.search_members(
  q text,
  status text default 'all',
  page integer default 1,
  page_size integer default 20
)
returns table (
  user_id uuid,
  member_id text,
  email text,
  first_name text,
  last_name text,
  phone text,
  role text,
  created_at timestamptz,
  date_of_birth date,
  is_active boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_catalog
as $$
begin
  perform public.require_staff();
  return query
    select * from public.search_members_impl(q, status, page, page_size);
end;
$$;

-- Permissions: never allow anon; allow staff (authenticated) and server-side (service_role).
revoke execute on function public.search_members(text,text,integer,integer) from public;
revoke execute on function public.search_members(text,text,integer,integer) from anon;
grant  execute on function public.search_members(text,text,integer,integer) to authenticated;
grant  execute on function public.search_members(text,text,integer,integer) to service_role;

-- Prevent bypass: impl must not be callable directly.
do $$
begin
  if to_regprocedure('public.search_members_impl(text,text,integer,integer)') is not null then
    execute 'revoke execute on function public.search_members_impl(text,text,integer,integer) from public';
    execute 'revoke execute on function public.search_members_impl(text,text,integer,integer) from anon';
    execute 'revoke execute on function public.search_members_impl(text,text,integer,integer) from authenticated';
  end if;
end $$;

notify pgrst, 'reload schema';
