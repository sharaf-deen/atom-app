-- Fix wrapper signature for search_members to match v6 (created_at + date_of_birth included).
-- This prevents runtime errors like:
--   "Returned type timestamptz does not match expected type boolean in column 8"
-- when the wrapper delegates to search_members_impl.

do $$
begin
  -- Only run if the hardened wrapper pattern exists.
  if to_regprocedure('public.search_members_impl(text,text,integer,integer)') is null then
    -- Nothing to do (no wrapper/impl split in this DB).
    return;
  end if;
end $$;

create or replace function public.search_members(
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
grant  execute on function public.search_members(text,text,integer,integer) to authenticated;
grant  execute on function public.search_members(text,text,integer,integer) to service_role;

-- Prevent bypass: impl must not be callable directly.
revoke execute on function public.search_members_impl(text,text,integer,integer) from public;

notify pgrst, 'reload schema';
