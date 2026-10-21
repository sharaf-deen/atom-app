-- Functional 1D.1B.2D, stage 1: durable provisioning claim metadata.
-- No accounts or consent evidence are created by this migration.
ALTER TABLE public.atom_public_registration_requests
  ADD COLUMN IF NOT EXISTS provisioning_claim_id uuid,
  ADD COLUMN IF NOT EXISTS provisioning_claimed_at timestamptz;
