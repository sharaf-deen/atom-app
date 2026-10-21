-- Functional 1D.1B.2: record an independently verified account owner before provisioning.
-- This field is NOT set from the public form. Only trusted service-role workflows
-- may update it after verifying control of the email identity.
ALTER TABLE public.atom_public_registration_requests
  ADD COLUMN IF NOT EXISTS identity_verified_at timestamptz;
