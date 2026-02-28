-- Fix: PostgREST/Supabase RPC schema cache expects argument names used by the client call:
--   rpc('search_members', { page, page_size, q, status })
-- Our function previously used _q/_status/_page/_page_size, so PostgREST couldn't match it.
-- This migration updates argument names to q/status/page/page_size without changing the signature.

-- NOTE: PostgreSQL does NOT allow changing input parameter names with CREATE OR REPLACE.
-- We must DROP then CREATE to rename input parameters.
drop function if exists public.search_members(text, text, integer, integer);

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
  is_active boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  q_txt text := coalesce(btrim(q), '');
  q_lower text := lower(coalesce(btrim(q), ''));
  status_txt text := case when status in ('all','active','inactive') then status else 'all' end;

  page_n int := greatest(coalesce(page, 1), 1);
  page_size_n int := greatest(1, least(coalesce(page_size, 20), 200));
  _offset int := (page_n - 1) * page_size_n;

  use_fts boolean := false;
  member_id_norm text := null;
  digits text := null;

  len int := 0;
begin
  len := length(q_txt);
  use_fts := (q_txt <> '' and (position(' ' in q_txt) > 0 or position('"' in q_txt) > 0));

  -- Normalize member id: "atom 123" / "ATOM-123" / "atom123" -> "ATOM-000123"
  if q_txt <> '' then
    digits := regexp_replace(q_txt, '\D', '', 'g');
    if digits <> '' then
      if length(digits) > 6 then
        digits := right(digits, 6);
      end if;
      member_id_norm := 'ATOM-' || lpad(digits, 6, '0');
    end if;
  end if;

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
      (status_txt = 'all'
        or (status_txt = 'active' and m.is_active = true)
        or (status_txt = 'inactive' and m.is_active = false)
      )
      and (
        -- empty query: allow all
        q_txt = ''

        -- Exact UUID match
        or (m.user_id::text = q_txt)

        -- member_id exact / normalized / prefix / contains
        or (m.member_id = q_txt)
        or (member_id_norm is not null and m.member_id = member_id_norm)
        or (len >= 3 and m.member_id ilike (q_txt || '%'))
        or (len >= 3 and m.member_id ilike ('%' || q_txt || '%'))

        -- email exact / prefix / contains (no similarity)
        or (lower(m.email) = q_lower)
        or (len >= 4 and lower(m.email) like (q_lower || '%'))
        or (len >= 4 and m.email ilike ('%' || q_txt || '%'))

        -- name contains
        or (len >= 2 and m.first_name ilike ('%' || q_txt || '%'))
        or (len >= 2 and m.last_name ilike ('%' || q_txt || '%'))

        -- phone contains (avoid super broad)
        or (len >= 4 and m.phone ilike ('%' || q_txt || '%'))

        -- FTS for multi words
        or (
          use_fts
          and to_tsvector('simple',
            coalesce(m.member_id,'') || ' ' ||
            coalesce(m.email,'') || ' ' ||
            coalesce(m.first_name,'') || ' ' ||
            coalesce(m.last_name,'') || ' ' ||
            coalesce(m.phone,'')
          ) @@ websearch_to_tsquery('simple', q_txt)
        )

        -- Fuzzy (names + member_id only), guarded
        or (
          len >= 3 and greatest(
            similarity(coalesce(m.first_name,''), q_txt),
            similarity(coalesce(m.last_name,''), q_txt),
            similarity(coalesce(m.member_id,''), q_txt)
          ) > 0.25
        )
      )
  ),
  scored as (
    select
      b.*,
      case when q_txt = '' then 0 else (
        -- exact/prefix first
        (case when b.user_id::text = q_txt then 1000 else 0 end)
        + (case when lower(b.email) = q_lower then 970 else 0 end)
        + (case when len >= 4 and lower(b.email) like (q_lower || '%') then 950 else 0 end)
        + (case when b.member_id = q_txt then 940 else 0 end)
        + (case when member_id_norm is not null and b.member_id = member_id_norm then 930 else 0 end)
        + (case when len >= 3 and b.member_id ilike (q_txt || '%') then 920 else 0 end)

        -- multi-word relevance
        + (case when use_fts then
            120 * ts_rank_cd(
              to_tsvector('simple',
                coalesce(b.member_id,'') || ' ' ||
                coalesce(b.email,'') || ' ' ||
                coalesce(b.first_name,'') || ' ' ||
                coalesce(b.last_name,'') || ' ' ||
                coalesce(b.phone,'')
              ),
              websearch_to_tsquery('simple', q_txt)
            )
          else 0 end)

        -- fuzzy similarity (names + member_id)
        + 12 * greatest(
            similarity(coalesce(b.first_name,''), q_txt),
            similarity(coalesce(b.last_name,''), q_txt)
          )
        + 6 * similarity(coalesce(b.member_id,''), q_txt)

        -- light boosts for contains
        + (case when len >= 2 and (b.first_name ilike ('%'||q_txt||'%') or b.last_name ilike ('%'||q_txt||'%')) then 2 else 0 end)
        + (case when len >= 4 and b.email ilike ('%'||q_txt||'%') then 1 else 0 end)
      ) end as score
    from base b
  ),
  counted as (
    select s.*, count(*) over() as total_count
    from scored s
  )
  select
    c.user_id,
    c.member_id,
    c.email,
    c.first_name,
    c.last_name,
    c.phone,
    c.role,
    c.is_active,
    c.total_count
  from counted c
  order by c.score desc, c.last_name nulls last, c.first_name nulls last, c.member_id nulls last
  offset _offset
  limit page_size_n;
end;
$$;

-- Server-side only
revoke all on function public.search_members(text, text, integer, integer) from public;
grant execute on function public.search_members(text, text, integer, integer) to service_role;

-- Ask PostgREST to reload schema cache (fixes "Could not find the function ... in the schema cache")
notify pgrst, 'reload schema';
