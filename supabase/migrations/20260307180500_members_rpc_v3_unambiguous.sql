-- Unambiguous PostgREST RPC for members list.
-- PostgREST uses named parameters; having two overloads with the same param names causes ambiguity.
-- We KEEP only: search_members_v3(q,status,page,page_size) and DROP the other overload.

-- Drop the ambiguous overload (page,page_size,q,status) if present
DROP FUNCTION IF EXISTS public.search_members_v3(integer, integer, text, text);

-- Ensure core exists (safe to re-define)
CREATE OR REPLACE FUNCTION public.search_members_v3_core(
  q text,
  status text,
  page integer,
  page_size integer
)
RETURNS TABLE(
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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      p.user_id,
      p.email,
      p.first_name,
      p.last_name,
      p.phone,
      p.role::text AS role,
      p.created_at,
      p.member_id,
      p.date_of_birth,
      COALESCE(mv.is_active, false) AS is_active,
      p.search_tsv,
      p.phone_digits
    FROM public.profiles p
    LEFT JOIN public.members_with_activity_mv mv
      ON mv.user_id = p.user_id
    WHERE p.role = 'member'
  ),
  filtered AS (
    SELECT *
    FROM base
    WHERE
      (
        q IS NULL
        OR btrim(q) = ''
        OR (
          (search_tsv @@ plainto_tsquery('simple', q))
          OR (lower(COALESCE(email, '')) LIKE '%' || lower(q) || '%')
          OR (lower(COALESCE(first_name, '')) LIKE '%' || lower(q) || '%')
          OR (lower(COALESCE(last_name, '')) LIKE '%' || lower(q) || '%')
          OR (lower(COALESCE(member_id, '')) LIKE '%' || lower(q) || '%')
          OR (
            regexp_replace(COALESCE(q, ''), '\D', '', 'g') <> ''
            AND phone_digits LIKE '%' || regexp_replace(q, '\D', '', 'g') || '%'
          )
        )
      )
      AND (
        status = 'all'
        OR (status = 'active' AND is_active = true)
        OR (status = 'inactive' AND is_active = false)
      )
  ),
  numbered AS (
    SELECT
      user_id,
      email,
      first_name,
      last_name,
      phone,
      role,
      created_at,
      member_id,
      date_of_birth,
      is_active,
      COUNT(*) OVER()::bigint AS total_count
    FROM filtered
    ORDER BY created_at DESC NULLS LAST, member_id ASC NULLS LAST
    OFFSET GREATEST((page - 1) * page_size, 0)
    LIMIT LEAST(page_size, 200)
  )
  SELECT * FROM numbered;
$$;

-- Keep ONLY one RPC signature for PostgREST (named params): (q,status,page,page_size)
CREATE OR REPLACE FUNCTION public.search_members_v3(
  q text,
  status text,
  page integer,
  page_size integer
)
RETURNS TABLE(
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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.search_members_v3_core(q, status, page, page_size);
$$;

COMMENT ON FUNCTION public.search_members_v3(text, text, integer, integer) IS
  'Search/paginate members from profiles LEFT JOIN members_with_activity_mv; includes members without activity (inactive). PostgREST-safe (single signature).';

-- Stats (safe to re-define)
CREATE OR REPLACE FUNCTION public.members_activity_stats_v3()
RETURNS TABLE(total bigint, active bigint, inactive bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      p.user_id,
      COALESCE(mv.is_active, false) AS is_active
    FROM public.profiles p
    LEFT JOIN public.members_with_activity_mv mv
      ON mv.user_id = p.user_id
    WHERE p.role = 'member'
  )
  SELECT
    COUNT(*)::bigint AS total,
    COUNT(*) FILTER (WHERE is_active)::bigint AS active,
    COUNT(*) FILTER (WHERE NOT is_active)::bigint AS inactive
  FROM base;
$$;

-- Permissions for PostgREST
GRANT EXECUTE ON FUNCTION public.search_members_v3(text, text, integer, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.members_activity_stats_v3() TO anon, authenticated, service_role;

-- Refresh schema cache for PostgREST (best effort)
DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
