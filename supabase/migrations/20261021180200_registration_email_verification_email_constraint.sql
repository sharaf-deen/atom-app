-- Persist only canonical email addresses in the verification snapshot.
ALTER TABLE public.atom_public_registration_requests
  ADD CONSTRAINT atom_public_registration_verified_email_check
  CHECK (verified_account_email IS NULL OR
    (verified_account_email = lower(btrim(verified_account_email))
    AND char_length(verified_account_email) BETWEEN 3 AND 254));
