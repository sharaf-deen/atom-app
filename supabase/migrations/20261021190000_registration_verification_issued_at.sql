-- Track the last issued verification token for atomic per-request cooldown.
ALTER TABLE public.atom_public_registration_requests
    ADD COLUMN IF NOT EXISTS verification_issued_at timestamptz;
