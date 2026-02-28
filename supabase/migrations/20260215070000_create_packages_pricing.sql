-- Create packages_pricing table for Packages & Promos page
--
-- NOTE: A previous migration (20260214_packages_pricing.sql) created a legacy
-- `public.packages_pricing` table with a JSONB column named `pricing`.
--
-- On fresh resets, that legacy table can exist first. We detect it, rename it
-- to `packages_pricing_legacy`, and also rename its pkey index/constraint so we
-- can safely create the new schema (with `is_active`, etc.).

DO $$
DECLARE
  has_legacy boolean := false;
  pk_index_table text;
BEGIN
  -- Detect legacy table shape (has `pricing` OR does not have `name`)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'packages_pricing'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'packages_pricing' AND column_name = 'pricing'
    ) OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'packages_pricing' AND column_name = 'name'
    ) THEN
      has_legacy := true;
    END IF;
  END IF;

  IF has_legacy THEN
    -- Rename legacy table out of the way
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'packages_pricing_legacy'
    ) THEN
      ALTER TABLE public.packages_pricing RENAME TO packages_pricing_legacy;
    ELSE
      -- Very defensive: avoid failing if the legacy target name is already taken.
      ALTER TABLE public.packages_pricing RENAME TO packages_pricing_legacy_2;
    END IF;

    -- Rename legacy PK constraint (if present). This also typically renames the index.
    BEGIN
      ALTER TABLE public.packages_pricing_legacy RENAME CONSTRAINT packages_pricing_pkey TO packages_pricing_legacy_pkey;
    EXCEPTION
      WHEN undefined_table OR undefined_object THEN
        NULL;
    END;
  END IF;

  -- If an index named `packages_pricing_pkey` still exists but does not belong to
  -- `public.packages_pricing`, rename it so the new table can create its own PK.
  SELECT tbl.relname INTO pk_index_table
  FROM pg_class idx
  JOIN pg_namespace n ON n.oid = idx.relnamespace
  JOIN pg_index i ON i.indexrelid = idx.oid
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  WHERE n.nspname = 'public'
    AND idx.relname = 'packages_pricing_pkey'
  LIMIT 1;

  IF pk_index_table IS NOT NULL AND pk_index_table <> 'packages_pricing' THEN
    EXECUTE format(
      'ALTER INDEX public.%I RENAME TO %I',
      'packages_pricing_pkey',
      pk_index_table || '_pkey'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.packages_pricing (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL,
  unit text NOT NULL,
  qty integer NOT NULL,
  price_egp integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  PRIMARY KEY (id),
  CONSTRAINT packages_pricing_type_check CHECK (type = ANY (ARRAY['membership'::text, 'private'::text])),
  CONSTRAINT packages_pricing_unit_check CHECK (unit = ANY (ARRAY['month'::text, 'session'::text])),
  CONSTRAINT packages_pricing_qty_check CHECK (qty >= 1),
  CONSTRAINT packages_pricing_price_check CHECK (price_egp >= 0),
  CONSTRAINT packages_pricing_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES profiles (user_id) ON DELETE SET NULL
);

-- Ensure expected columns exist (idempotent across future edits)
ALTER TABLE public.packages_pricing
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_packages_pricing_active ON public.packages_pricing USING btree (is_active);
CREATE INDEX IF NOT EXISTS idx_packages_pricing_sort ON public.packages_pricing USING btree (sort_order);
CREATE INDEX IF NOT EXISTS idx_packages_pricing_type_unit_qty ON public.packages_pricing USING btree (type, unit, qty);

ALTER TABLE public.packages_pricing ENABLE ROW LEVEL SECURITY;

-- Everyone logged in can read
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'packages_pricing'
      AND policyname = 'packages_pricing_read_authenticated'
  ) THEN
    CREATE POLICY packages_pricing_read_authenticated
      ON public.packages_pricing
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

-- Only super_admin can write (if you later decide to use the normal Supabase client with RLS)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'packages_pricing'
      AND policyname = 'packages_pricing_write_super_admin'
  ) THEN
    CREATE POLICY packages_pricing_write_super_admin
      ON public.packages_pricing
      FOR ALL
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.user_id = auth.uid() AND p.role = 'super_admin'
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.user_id = auth.uid() AND p.role = 'super_admin'
        )
      );
  END IF;
END $$;
