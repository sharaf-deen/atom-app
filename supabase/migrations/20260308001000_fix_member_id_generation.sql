-- Fix: ensure member_id is ALWAYS generated for new profiles (and backfill existing NULL/blank values)
-- Notes:
-- - Safe on empty databases used by CI reset/smoke.
-- - Uses public.member_id_seq seeded from the current max ATOM-XXXXXX value.
-- - Covers INSERT and UPDATE so profile upserts/updates also receive member_id if missing.
-- - Keeps public.generate_member_id() aligned with the new sequence for compatibility.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'member_id_seq'
      AND c.relkind = 'S'
  ) THEN
    CREATE SEQUENCE public.member_id_seq;
  END IF;
END $$;

-- Seed sequence from the highest existing ATOM-XXXXXX value.
-- Important for CI/reset: setval(..., 0, true) would fail on an empty DB,
-- so when no rows exist we seed with (1, false) so nextval() returns 1.
DO $$
DECLARE
  v_max bigint;
BEGIN
  SELECT COALESCE(MAX((regexp_replace(member_id, '\D', '', 'g'))::bigint), 0)
  INTO v_max
  FROM public.profiles
  WHERE member_id IS NOT NULL
    AND member_id ~ '^ATOM-\d{6}$';

  IF v_max > 0 THEN
    PERFORM setval('public.member_id_seq'::regclass, v_max, true);
  ELSE
    PERFORM setval('public.member_id_seq'::regclass, 1, false);
  END IF;
END $$;

-- Compatibility: keep the canonical generator function aligned with member_id_seq.
CREATE OR REPLACE FUNCTION public.generate_member_id()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  n bigint;
BEGIN
  n := nextval('public.member_id_seq'::regclass);
  RETURN 'ATOM-' || lpad(n::text, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.fill_member_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.member_id IS NULL OR btrim(NEW.member_id) = '' THEN
    NEW.member_id := public.generate_member_id();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_member_id ON public.profiles;

CREATE TRIGGER trg_fill_member_id
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.fill_member_id();

-- Backfill existing rows with NULL/blank member_id deterministically.
DO $$
DECLARE
  v_start bigint;
BEGIN
  SELECT COALESCE(MAX((regexp_replace(member_id, '\D', '', 'g'))::bigint), 0)
  INTO v_start
  FROM public.profiles
  WHERE member_id IS NOT NULL
    AND member_id ~ '^ATOM-\d{6}$';

  WITH missing AS (
    SELECT
      user_id,
      row_number() OVER (ORDER BY created_at ASC NULLS LAST, user_id ASC) AS rn
    FROM public.profiles
    WHERE member_id IS NULL OR btrim(member_id) = ''
  )
  UPDATE public.profiles p
  SET member_id = 'ATOM-' || lpad((v_start + missing.rn)::text, 6, '0')
  FROM missing
  WHERE p.user_id = missing.user_id;

  -- Re-seed sequence after backfill.
  SELECT COALESCE(MAX((regexp_replace(member_id, '\D', '', 'g'))::bigint), 0)
  INTO v_start
  FROM public.profiles
  WHERE member_id IS NOT NULL
    AND member_id ~ '^ATOM-\d{6}$';

  IF v_start > 0 THEN
    PERFORM setval('public.member_id_seq'::regclass, v_start, true);
  ELSE
    PERFORM setval('public.member_id_seq'::regclass, 1, false);
  END IF;
END $$;

-- Ensure PostgREST sees changes quickly.
DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN others THEN
  NULL;
END $$;
