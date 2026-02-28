-- v5: smarter ranking + safer fuzzy rules.
-- - Prioritizes exact/prefix matches (UUID/email/member_id)
-- - Limits fuzzy similarity to names and member_id only (not email/phone)
-- - Adds minimal length guards to avoid overly-broad scans
-- - Keeps same signature used by the app

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
stable
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  q text := coalesce(btrim(_q), '');
  q_lower text := lower(coalesce(btrim(_q), ''));
  status text := case when _status in ('all','active','inactive') then _status else 'all' end;
  page int := greatest(coalesce(_page, 1), 1);
  page_size int := greatest(1, least(coalesce(_page_size, 20), 200));
  _offset int := (page - 1) * page_size;

  use_fts boolean := false;
  member_id_norm text := null;
  digits text := null;
  is_email boolean := false;

  len int := 0;
begin
  len := length(q);
  is_email := (q <> '' and position('@' in q) > 1);
  use_fts := (q <> '' and (position(' ' in q) > 0 or position('"' in q) > 0));

  -- Normalize member id: "atom 123" / "ATOM-123" / "atom123" -> "ATOM-000123"
  if q <> '' then
    digits := regexp_replace(q, '\D', '', 'g');
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
      (status = 'all'
        or (status = 'active' and m.is_active = true)
        or (status = 'inactive' and m.is_active = false)
      )
      and (
        -- empty query: allow all
        q = ''

        -- Exact UUID match
        or (m.user_id::text = q)

        -- member_id exact / normalized / prefix / contains
        or (m.member_id = q)
        or (member_id_norm is not null and m.member_id = member_id_norm)
        or (len >= 3 and m.member_id ilike (q || '%'))
        or (len >= 3 and m.member_id ilike ('%' || q || '%'))

        -- email exact / prefix / contains (no similarity)
        or (lower(m.email) = q_lower)
        or (len >= 4 and lower(m.email) like (q_lower || '%'))
        or (len >= 4 and m.email ilike ('%' || q || '%'))

        -- name contains (always useful)
        or (len >= 2 and m.first_name ilike ('%' || q || '%'))
        or (len >= 2 and m.last_name ilike ('%' || q || '%'))

        -- phone contains (avoid super broad)
        or (len >= 4 and m.phone ilike ('%' || q || '%'))

        -- FTS for multi words
        or (
          use_fts
          and to_tsvector('simple',
            coalesce(m.member_id,'') || ' ' ||
            coalesce(m.email,'') || ' ' ||
            coalesce(m.first_name,'') || ' ' ||
            coalesce(m.last_name,'') || ' ' ||
            coalesce(m.phone,'')
          ) @@ websearch_to_tsquery('simple', q)
        )

        -- Fuzzy (names + member_id only), guarded
        or (
          len >= 3 and greatest(
            similarity(coalesce(m.first_name,''), q),
            similarity(coalesce(m.last_name,''), q),
            similarity(coalesce(m.member_id,''), q)
          ) > 0.25
        )
      )
  ),
  scored as (
    select
      b.*,
      case when q = '' then 0 else (
        -- exact/prefix first
        (case when b.user_id::text = q then 1000 else 0 end)
        + (case when lower(b.email) = q_lower then 970 else 0 end)
        + (case when len >= 4 and lower(b.email) like (q_lower || '%') then 950 else 0 end)
        + (case when b.member_id = q then 940 else 0 end)
        + (case when member_id_norm is not null and b.member_id = member_id_norm then 930 else 0 end)
        + (case when len >= 3 and b.member_id ilike (q || '%') then 920 else 0 end)

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
              websearch_to_tsquery('simple', q)
            )
          else 0 end)

        -- fuzzy similarity (names + member_id)
        + 12 * greatest(
            similarity(coalesce(b.first_name,''), q),
            similarity(coalesce(b.last_name,''), q)
          )
        + 6 * similarity(coalesce(b.member_id,''), q)

        -- light boosts for contains
        + (case when len >= 2 and (b.first_name ilike ('%'||q||'%') or b.last_name ilike ('%'||q||'%')) then 2 else 0 end)
        + (case when len >= 4 and b.email ilike ('%'||q||'%') then 1 else 0 end)
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
  limit page_size;

end;
$$;

-- Server-side only
revoke all on function public.search_members(text, text, integer, integer) from public;
grant execute on function public.search_members(text, text, integer, integer) to service_role;
