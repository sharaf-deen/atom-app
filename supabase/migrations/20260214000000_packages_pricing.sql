-- Packages pricing (legacy JSON seed)
-- IMPORTANT: This migration must be safe if the table already exists with the NEW schema (no "pricing" column).
-- We therefore guard the legacy seed insert behind a column-exists check.

create table if not exists public.packages_pricing (
  id int primary key,
  pricing jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.profiles (user_id) on delete set null
);

alter table public.packages_pricing enable row level security;

-- Everyone logged in can read
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'packages_pricing'
      AND policyname = 'packages_pricing_select_authenticated'
  ) THEN
    CREATE POLICY packages_pricing_select_authenticated
      ON public.packages_pricing
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END$$;

-- Only super_admin can insert/update/delete
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'packages_pricing'
      AND policyname = 'packages_pricing_write_super_admin'
  ) THEN
    CREATE POLICY packages_pricing_write_super_admin
      ON public.packages_pricing
      FOR ALL
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.profiles p
          WHERE p.user_id = auth.uid()
            AND p.role = 'super_admin'
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.profiles p
          WHERE p.user_id = auth.uid()
            AND p.role = 'super_admin'
        )
      );
  END IF;
END$$;

-- Seed default pricing (only if the legacy "pricing" column exists; remote may already be on the new schema)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'packages_pricing'
      AND column_name  = 'pricing'
  ) THEN
    INSERT INTO public.packages_pricing (id, pricing)
    VALUES (
      1,
      $json$
      {
        "memberships": [
          {"label": "1 Month", "price": "1,500 EGP"},
          {"label": "3 Months", "price": "4,000 EGP"},
          {"label": "6 Months", "price": "7,000 EGP"}
        ],
        "dropIn": [
          {"label": "Single Session", "price": "250 EGP"},
          {"label": "Try Class", "note": "Free"}
        ],
        "privateTraining": [
          {"label": "1 Session", "price": "1,200 EGP"},
          {"label": "5 Sessions", "price": "5,000 EGP"},
          {"label": "10 Sessions", "price": "9,000 EGP"}
        ]
      }
      $json$::jsonb
    )
    ON CONFLICT (id) DO NOTHING;
  ELSE
    RAISE NOTICE 'packages_pricing: legacy seed skipped (pricing column not present)';
  END IF;
END$$;
