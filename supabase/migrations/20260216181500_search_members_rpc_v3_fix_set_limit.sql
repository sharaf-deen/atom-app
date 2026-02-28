-- 20260216_1815_search_members_rpc_v3_fix_set_limit.sql
-- Fix: pg_trgm set_limit() schema + type casting.
-- In Postgres, GRANT/REVOKE for views/materialized views uses "ON TABLE".
-- This migration drops & recreates the RPC search_members() keeping the same signature:
--   public.search_members(q text, status text, page int, page_size int)

begin;

-- Ensure required extension exists (no-op if already installed).
create extension if not exists pg_trgm with schema extensions;

-- Drop old function to avoid "cannot change return type" and to apply fix cleanly.
drop function if exists public.search_members(text, text, integer, integer);

create or replace function public.search_members(
  q text,
  status text default 'all',
  page integer default 1,
  page_size integer default 30
)
returns table (
  user_id uuid,
  member_id text,
  email text,
  first_name text,
  last_name text,
  phone text,
  role text,
  is_active boolean,
  total_count bigint
)
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  _q text := coalesce(trim(q), '');
  _status text := lower(coalesce(status, 'all'));
  _page int := greatest(coalesce(page, 1), 1);
  _page_size int := greatest(least(coalesce(page_size, 30), 200), 1);
  _offset int := (_page - 1) * _page_size;

  -- For "smart" member_id normalization:
  -- Accepts: "atom 123", "ATOM-123", "atom-000123" -> "ATOM-000123"
  _digits text;
  _member_id_norm text;

  -- pg_trgm threshold management
  _old_limit real;
  _use_fts boolean := false;
begin
  -- Normalize member_id-like queries ("atom 123" -> "ATOM-000123")
  _digits := regexp_replace(_q, '[^0-9]+', '', 'g');
  if length(_digits) > 0 and length(_digits) <= 6 then
    _member_id_norm := 'ATOM-' || lpad(_digits, 6, '0');
  else
    _member_id_norm := null;
  end if;

  -- Decide whether to use FTS (multi-word queries)
  _use_fts := (strpos(_q, ' ') > 0);

  -- Set pg_trgm similarity limit in a schema-agnostic, type-safe way
  -- IMPORTANT: set_limit() expects real; numeric literals need casting.
  -- Using search_path makes it work whether pg_trgm lives in extensions or public.
  _old_limit := show_limit();
  perform set_limit(0.20::real);

  return query
  with base as (
    select
      m.user_id,
      m.member_id,
      m.email,
      m.first_name,
      m.last_name,
      m.phone,
      m.role,
      m.is_active
    from public.members_with_activity_mv m
    where
      -- Status filter
      (
        _status = 'all'
        or (_status = 'active' and m.is_active = true)
        or (_status = 'inactive' and m.is_active = false)
      )
      and
      (
        -- If query empty -> allow all
        _q = ''
        -- Exact UUID match (highest priority)
        or (m.user_id::text = _q)
        -- Exact member_id match, or normalized "atom 123" match
        or (m.member_id = _q)
        or (_member_id_norm is not null and m.member_id = _member_id_norm)
        -- Exact email match (case-insensitive)
        or (lower(m.email) = lower(_q))
        -- FTS (multi words) on name+email+member_id (web style query)
        or (
          _use_fts
          and to_tsvector('simple',
              coalesce(m.member_id,'') || ' ' ||
              coalesce(m.email,'') || ' ' ||
              coalesce(m.first_name,'') || ' ' ||
              coalesce(m.last_name,'') || ' ' ||
              coalesce(m.phone,'')
          ) @@ websearch_to_tsquery('simple', _q)
        )
        -- Fallback trigram similarity / contains
        or (m.member_id ilike ('%' || _q || '%'))
        or (m.email ilike ('%' || _q || '%'))
        or (m.first_name ilike ('%' || _q || '%'))
        or (m.last_name ilike ('%' || _q || '%'))
        or (m.phone ilike ('%' || _q || '%'))
        or (similarity(coalesce(m.first_name,''), _q) > 0.20)
        or (similarity(coalesce(m.last_name,''), _q) > 0.20)
      )
  ),
  scored as (
    select
      b.*,
      -- Ranking: exact matches first, then FTS rank, then trigram similarity
      (
        case when _q <> '' and b.user_id::text = _q then 1000 else 0 end +
        case when _q <> '' and lower(b.email) = lower(_q) then 900 else 0 end +
        case when _q <> '' and (b.member_id = _q or (_member_id_norm is not null and b.member_id = _member_id_norm)) then 850 else 0 end +
        case when _use_fts then
          100 * ts_rank_cd(
            to_tsvector('simple',
              coalesce(b.member_id,'') || ' ' ||
              coalesce(b.email,'') || ' ' ||
              coalesce(b.first_name,'') || ' ' ||
              coalesce(b.last_name,'') || ' ' ||
              coalesce(b.phone,'')
            ),
            websearch_to_tsquery('simple', _q)
          )
        else 0 end +
        greatest(
          similarity(coalesce(b.member_id,''), _q),
          similarity(coalesce(b.email,''), _q),
          similarity(coalesce(b.first_name,''), _q),
          similarity(coalesce(b.last_name,''), _q),
          similarity(coalesce(b.phone,''), _q)
        )
      ) as score
    from base b
  ),
  counted as (
    select *, count(*) over() as total_count
    from scored
  )
  select
    user_id, member_id, email, first_name, last_name, phone, role, is_active, total_count
  from counted
  order by score desc, last_name nulls last, first_name nulls last, member_id nulls last
  offset _offset
  limit _page_size;

  -- Reset trigram limit for session safety
  perform set_limit(_old_limit);

end;
$$;

-- Permissions: keep it server-only (service_role) since members listing is staff-only.
revoke all on function public.search_members(text, text, integer, integer) from anon, authenticated;
grant execute on function public.search_members(text, text, integer, integer) to service_role;

commit;
