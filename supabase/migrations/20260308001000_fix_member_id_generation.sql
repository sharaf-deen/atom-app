-- Fix: ensure member_id is ALWAYS generated for new profiles (and backfill existing NULLs)
-- Uses a sequence seeded from the current max ATOM-XXXXXX value.
-- Safe: only sets member_id when it's NULL/blank; never overwrites existing.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'member_id_seq'
  ) THEN
    CREATE SEQUENCE public.member_id_seq;
  END IF;
END $$;

-- Seed sequence to max existing numeric part (so nextval continues after current max)
DO $$
DECLARE
  v_max int;
BEGIN
  SELECT COALESCE(MAX((regexp_replace(member_id, '\D', '', 'g'))::int), 0)
  INTO v_max
  FROM public.profiles
  WHERE member_id IS NOT NULL
    AND member_id ~ '^ATOM-\d{6}$';

  -- setval(seq, v_max, true) => nextval = v_max + 1
  PERFORM setval('public.member_id_seq', v_max, true);
END $$;

CREATE OR REPLACE FUNCTION public.fill_member_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only generate if missing
  IF NEW.member_id IS NULL OR btrim(NEW.member_id) = '' THEN
    NEW.member_id := 'ATOM-' || lpad(nextval('public.member_id_seq')::text, 6, '0');
  END IF;

  RETURN NEW;
END;
$$;

-- Replace trigger to cover INSERT + UPDATE (so upserts/updates also get member_id if missing)
DROP TRIGGER IF EXISTS trg_fill_member_id ON public.profiles;

CREATE TRIGGER trg_fill_member_id
BEFORE INSERT OR UPDATE OF member_id ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.fill_member_id();

-- Backfill existing rows with NULL/blank member_id deterministically (based on created_at)
DO $$
DECLARE
  v_start int;
BEGIN
  SELECT COALESCE(MAX((regexp_replace(member_id, '\D', '', 'g'))::int), 0)
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

  -- Re-seed sequence after backfill
  SELECT COALESCE(MAX((regexp_replace(member_id, '\D', '', 'g'))::int), 0)
  INTO v_start
  FROM public.profiles
  WHERE member_id IS NOT NULL
    AND member_id ~ '^ATOM-\d{6}$';

  PERFORM setval('public.member_id_seq', v_start, true);
END $$;

-- Ensure PostgREST sees changes quickly
DO $$ BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN others THEN
  NULL;
END $$;