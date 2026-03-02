-- Pro search RPC for /members (FTS + trigram) using the materialized view snapshot.
-- Returns paged rows + total_count in one call.
--
-- Remote-compat:
-- Some databases already have an older search_members() with a different RETURNS TABLE (OUT columns).
-- Postgres cannot change return type with CREATE OR REPLACE in that case, so we drop all overloads first.

-- Ensure pg_trgm exists (needed for similarity).
create extension if not exists pg_trgm with schema extensions;

-- Drop any existing overloads so we can recreate with the current RETURNS TABLE safely.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'search_members'
  LOOP
    EXECUTE 'drop function if exists ' || r.sig;
  END LOOP;
END $$;

create or replace function public.search_members(
  q text default null,
  status text default 'all',
  page integer default 1,
  page_size integer default 20
)
returns table(
  user_id uuid,
  email text,
  first_name text,
  last_name text,
  phone text,
  role text,
  created_at timestamptz,
  member_id text,
  date_of_birth date,
  is_active boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  q_trim text := nullif(trim(coalesce(q, '')), '');
  st text := lower(coalesce(status, 'all'));
  p int := greatest(coalesce(page, 1), 1);
  ps int := greatest(5, least(coalesce(page_size, 20), 200));
  off int := (p - 1) * ps;
  use_fts boolean := false;
  tsq tsquery;
begin
  if st not in ('all', 'active', 'inactive') then
    st := 'all';
  end if;

  -- Avoid "1 letter" searches that would basically match everything.
  if q_trim is not null and length(q_trim) < 2 then
    q_trim := null;
  end if;

  if q_trim is not null then
    -- FTS is best for multi-word queries.
    use_fts := position(' ' in q_trim) > 0;
    if use_fts then
      tsq := websearch_to_tsquery('simple', q_trim);
    end if;
  end if;

  -- No query: list mode
  if q_trim is null then
    return query
    with base as (
      select m.*
      from public.members_with_activity_mv m
      where (st = 'all')
         or (st = 'active' and m.is_active)
         or (st = 'inactive' and not m.is_active)
    ),
    c as (
      select count(*)::bigint as total_count from base
    ),
    pg as (
      select *
      from base
      order by created_at desc nulls last
      limit ps offset off
    )
    select
      pg.user_id,
      pg.email,
      pg.first_name,
      pg.last_name,
      pg.phone,
      pg.role,
      pg.created_at,
      pg.member_id,
      pg.date_of_birth,
      pg.is_active,
      c.total_count
    from pg cross join c;
    return;
  end if;

  -- Multi-word search: FTS
  if use_fts then
    return query
    with base as (
      select
        m.*,
        ts_rank_cd(
          to_tsvector(
            'simple',
            coalesce(m.member_id, '') || ' ' ||
            coalesce(m.email, '') || ' ' ||
            coalesce(m.first_name, '') || ' ' ||
            coalesce(m.last_name, '') || ' ' ||
            coalesce(m.phone, '')
          ),
          tsq
        ) as rank
      from public.members_with_activity_mv m
      where
        to_tsvector(
          'simple',
          coalesce(m.member_id, '') || ' ' ||
          coalesce(m.email, '') || ' ' ||
          coalesce(m.first_name, '') || ' ' ||
          coalesce(m.last_name, '') || ' ' ||
          coalesce(m.phone, '')
        ) @@ tsq
        and (
          (st = 'all')
          or (st = 'active' and m.is_active)
          or (st = 'inactive' and not m.is_active)
        )
    ),
    c as (
      select count(*)::bigint as total_count from base
    ),
    pg as (
      select *
      from base
      order by rank desc, created_at desc nulls last
      limit ps offset off
    )
    select
      pg.user_id,
      pg.email,
      pg.first_name,
      pg.last_name,
      pg.phone,
      pg.role,
      pg.created_at,
      pg.member_id,
      pg.date_of_birth,
      pg.is_active,
      c.total_count
    from pg cross join c;
    return;
  end if;

  -- Single-token search: trigram / contains (fast with pg_trgm GIN indexes)
  return query
  with base as (
    select
      m.*,
      greatest(
        extensions.similarity(coalesce(m.member_id, ''), q_trim),
        extensions.similarity(coalesce(m.email, ''), q_trim),
        extensions.similarity(coalesce(m.first_name, ''), q_trim),
        extensions.similarity(coalesce(m.last_name, ''), q_trim),
        extensions.similarity(coalesce(m.phone, ''), q_trim)
      ) as sim
    from public.members_with_activity_mv m
    where (
      m.member_id ilike '%' || q_trim || '%'
      or m.email ilike '%' || q_trim || '%'
      or m.first_name ilike '%' || q_trim || '%'
      or m.last_name ilike '%' || q_trim || '%'
      or m.phone ilike '%' || q_trim || '%'
    )
    and (
      (st = 'all')
      or (st = 'active' and m.is_active)
      or (st = 'inactive' and not m.is_active)
    )
  ),
  c as (
    select count(*)::bigint as total_count from base
  ),
  pg as (
    select *
    from base
    order by
      (case when member_id ilike q_trim || '%' then 0 else 1 end),
      sim desc,
      created_at desc nulls last
    limit ps offset off
  )
  select
    pg.user_id,
    pg.email,
    pg.first_name,
    pg.last_name,
    pg.phone,
    pg.role,
    pg.created_at,
    pg.member_id,
    pg.date_of_birth,
    pg.is_active,
    c.total_count
  from pg cross join c;
end;
$$;

-- Security: server-only (Next uses service_role)
revoke all on function public.search_members(text, text, integer, integer) from anon, authenticated;
grant execute on function public.search_members(text, text, integer, integer) to service_role;
