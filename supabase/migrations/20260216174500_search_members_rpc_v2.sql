-- search_members RPC v2
-- Improvements:
-- - Exact match priority (member_id / email / uuid / phone)
-- - Smarter member_id parsing: "atom 123" -> "ATOM-000123"
-- - Ranking: exact_score > FTS rank > trigram similarity > recency
-- - Still returns paged rows + total_count in one call

create extension if not exists pg_trgm with schema extensions;

-- We recreate the function to allow internal logic changes safely.
drop function if exists public.search_members(text, text, integer, integer);

create function public.search_members(
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
  q_raw text := nullif(trim(coalesce(q, '')), '');
  q_clean text := null;
  q_lower text := null;
  q_upper text := null;

  st text := lower(coalesce(status, 'all'));
  p int := greatest(coalesce(page, 1), 1);
  ps int := greatest(5, least(coalesce(page_size, 20), 200));
  off int := (p - 1) * ps;

  digits text := null;
  member_candidate text := null;
  uuid_candidate uuid := null;
  is_email boolean := false;

  tsq tsquery := null;
  pat text := null;
begin
  if st not in ('all', 'active', 'inactive') then
    st := 'all';
  end if;

  -- Normalize query (keep a fairly permissive charset for emails / ids)
  if q_raw is not null then
    q_clean := regexp_replace(q_raw, '\s+', ' ', 'g');
    q_clean := trim(q_clean);
    q_lower := lower(q_clean);
    q_upper := upper(q_clean);

    -- Avoid 1-char queries that match everything.
    if length(q_clean) < 2 then
      q_clean := null;
    end if;
  end if;

  -- LIST MODE
  if q_clean is null then
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

  -- Heuristics for exact matching
  is_email := position('@' in q_clean) > 1;

  -- UUID search
  if q_clean ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    uuid_candidate := q_clean::uuid;
  end if;

  -- Member ID parsing:
  --   "ATOM-123" / "atom 123" / "atom000123" / "123"  =>  ATOM-000123
  if q_clean ~* '^atom[- ]?\d{1,6}$' then
    digits := regexp_replace(q_clean, '\\D', '', 'g');
  elsif q_clean ~ '^\d{1,6}$' then
    digits := q_clean;
  else
    digits := null;
  end if;

  if digits is not null and digits <> '' then
    member_candidate := 'ATOM-' || lpad(digits, 6, '0');
  end if;

  -- FTS query (websearch syntax is user-friendly)
  begin
    tsq := websearch_to_tsquery('simple', q_clean);
  exception when others then
    tsq := null;
  end;

  -- Trigram fuzzy match threshold (used by the % operator)
  perform extensions.set_limit(0.20);

  pat := '%' || q_clean || '%';

  return query
  with scored as (
    select
      m.*,
      to_tsvector(
        'simple',
        coalesce(m.member_id, '') || ' ' ||
        coalesce(m.email, '') || ' ' ||
        coalesce(m.first_name, '') || ' ' ||
        coalesce(m.last_name, '') || ' ' ||
        coalesce(m.phone, '')
      ) as vec,
      case
        when uuid_candidate is not null and m.user_id = uuid_candidate then 1000
        when member_candidate is not null and m.member_id = member_candidate then 950
        when member_candidate is not null and upper(m.member_id) = upper(member_candidate) then 950
        when m.member_id is not null and upper(m.member_id) = q_upper then 940
        when is_email and m.email is not null and lower(m.email) = q_lower then 930
        when m.phone is not null and m.phone = q_clean then 900
        else 0
      end as exact_score
    from public.members_with_activity_mv m
    where (st = 'all')
       or (st = 'active' and m.is_active)
       or (st = 'inactive' and not m.is_active)
  ),
  matched as (
    select
      s.*,
      (tsq is not null and s.vec @@ tsq) as fts_match,
      case when tsq is not null then ts_rank_cd(s.vec, tsq) else 0::real end as fts_rank,
      (
        (s.member_id is not null and s.member_id ilike pat) or
        (s.email is not null and s.email ilike pat) or
        (s.first_name is not null and s.first_name ilike pat) or
        (s.last_name is not null and s.last_name ilike pat) or
        (s.phone is not null and s.phone ilike pat)
      ) as ilike_match,
      (
        (s.member_id is not null and s.member_id % q_clean) or
        (s.email is not null and s.email % q_clean) or
        (s.first_name is not null and s.first_name % q_clean) or
        (s.last_name is not null and s.last_name % q_clean) or
        (s.phone is not null and s.phone % q_clean)
      ) as fuzzy_match
    from scored s
  ),
  base as (
    select *
    from matched
    where exact_score > 0
       or fts_match
       or ilike_match
       or fuzzy_match
  ),
  ranked as (
    select
      b.*,
      greatest(
        extensions.similarity(coalesce(b.member_id, ''), q_clean),
        extensions.similarity(coalesce(b.email, ''), q_clean),
        extensions.similarity(coalesce(b.first_name, ''), q_clean),
        extensions.similarity(coalesce(b.last_name, ''), q_clean),
        extensions.similarity(coalesce(b.phone, ''), q_clean)
      ) as sim_score
    from base b
  ),
  c as (
    select count(*)::bigint as total_count from ranked
  ),
  pg as (
    select *
    from ranked
    order by
      exact_score desc,
      fts_rank desc,
      sim_score desc,
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

-- Tight privileges (RPC is meant to be called with service_role via your admin client)
revoke all on function public.search_members(text, text, integer, integer) from anon, authenticated;
grant execute on function public.search_members(text, text, integer, integer) to service_role;
