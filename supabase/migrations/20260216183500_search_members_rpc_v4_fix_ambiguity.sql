-- v4: Fix ambiguous column references by qualifying output columns with an alias.
-- Also: ensure set_limit is resolved via search_path and uses correct type.
-- Safe to re-run (drops & recreates the function).

drop function if exists public.search_members(text, text, integer, integer);

create function public.search_members(
  _q text,
  _status text default 'all',
  _page integer default 1,
  _page_size integer default 20
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
  q text := coalesce(btrim(_q), '');
  status text := case when _status in ('all','active','inactive') then _status else 'all' end;
  page int := greatest(coalesce(_page, 1), 1);
  page_size int := greatest(1, least(coalesce(_page_size, 20), 200));
  _offset int := (page - 1) * page_size;

  _use_fts boolean := false;
  _member_id_norm text := null;
  _digits text := null;
begin
  -- pg_trgm similarity threshold (float4/real)
  perform set_limit(0.20::real);

  -- Detect multi-word query -> use FTS websearch
  _use_fts := (q <> '' and (position(' ' in q) > 0 or position('"' in q) > 0));

  -- Normalize member id: "atom 123" / "ATOM-123" / "atom123" -> "ATOM-000123"
  if q <> '' then
    _digits := regexp_replace(q, '\D', '', 'g');
    if _digits <> '' then
      if length(_digits) > 6 then
        _digits := right(_digits, 6);
      end if;
      _member_id_norm := 'ATOM-' || lpad(_digits, 6, '0');
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
      -- Status filter
      (status = 'all'
        or (status = 'active' and m.is_active = true)
        or (status = 'inactive' and m.is_active = false)
      )
      and (
        -- If query empty -> allow all
        q = ''

        -- Exact UUID match (highest priority)
        or (m.user_id::text = q)

        -- Exact member_id match, or normalized "atom 123" match
        or (m.member_id = q)
        or (_member_id_norm is not null and m.member_id = _member_id_norm)

        -- Exact email match (case-insensitive)
        or (lower(m.email) = lower(q))

        -- FTS (multi words) on name+email+member_id+phone (web style query)
        or (
          _use_fts
          and to_tsvector('simple',
            coalesce(m.member_id,'') || ' ' ||
            coalesce(m.email,'') || ' ' ||
            coalesce(m.first_name,'') || ' ' ||
            coalesce(m.last_name,'') || ' ' ||
            coalesce(m.phone,'')
          ) @@ websearch_to_tsquery('simple', q)
        )

        -- Fallback contains + similarity
        or (m.member_id ilike ('%' || q || '%'))
        or (m.email ilike ('%' || q || '%'))
        or (m.first_name ilike ('%' || q || '%'))
        or (m.last_name ilike ('%' || q || '%'))
        or (m.phone ilike ('%' || q || '%'))
        or (similarity(coalesce(m.first_name,''), q) > 0.20)
        or (similarity(coalesce(m.last_name,''), q) > 0.20)
      )
  ),
  scored as (
    select
      b.*,
      (
        case when q <> '' and b.user_id::text = q then 1000 else 0 end
        + case when q <> '' and lower(b.email) = lower(q) then 900 else 0 end
        + case when q <> '' and (b.member_id = q or (_member_id_norm is not null and b.member_id = _member_id_norm)) then 850 else 0 end
        + case when _use_fts then
            100 * ts_rank_cd(
              to_tsvector('simple',
                coalesce(b.member_id,'') || ' ' ||
                coalesce(b.email,'') || ' ' ||
                coalesce(b.first_name,'') || ' ' ||
                coalesce(b.last_name,'') || ' ' ||
                coalesce(b.phone,'')
              ),
              websearch_to_tsquery('simple', q)
            )
          else 0 end
        + greatest(
            similarity(coalesce(b.member_id,''), q),
            similarity(coalesce(b.email,''), q),
            similarity(coalesce(b.first_name,''), q),
            similarity(coalesce(b.last_name,''), q),
            similarity(coalesce(b.phone,''), q)
          )
      ) as score
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
  limit page_size;

  -- reset to default
  perform set_limit(0.30::real);
end;
$$;

-- Lock down: only service_role should execute this (server-side only).
revoke all on function public.search_members(text, text, integer, integer) from public;
grant execute on function public.search_members(text, text, integer, integer) to service_role;
