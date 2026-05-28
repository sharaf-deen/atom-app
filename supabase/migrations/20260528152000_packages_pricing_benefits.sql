-- Packages pricing benefits
-- Adds editable package benefits/advantages without changing subscription, sales, store, or payment flows.

ALTER TABLE public.packages_pricing
  ADD COLUMN IF NOT EXISTS benefits text[] NOT NULL DEFAULT ARRAY[]::text[];

COMMENT ON COLUMN public.packages_pricing.benefits IS 'Optional short benefits/advantages displayed with each package.';
