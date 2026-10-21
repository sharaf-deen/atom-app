-- Functional 1D.1B.2B: internal, one-time email ownership verification state.
-- Never store the raw token; no public direct table permissions are added.
ALTER TABLE public.atom_public_registration_requests
    ADD COLUMN IF NOT EXISTS verification_token_hash text,
    ADD COLUMN IF NOT EXISTS verification_email text,
    ADD COLUMN IF NOT EXISTS verification_expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS verified_account_email text;
