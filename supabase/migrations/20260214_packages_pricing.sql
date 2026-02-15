-- Packages pricing (editable by super_admin)

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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'packages_pricing' AND policyname = 'packages_pricing_select_authenticated'
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'packages_pricing' AND policyname = 'packages_pricing_write_super_admin'
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

-- Seed default pricing (only if empty)
insert into public.packages_pricing (id, pricing)
values (
  1,
  $$
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
  $$::jsonb
)
on conflict (id) do nothing;
