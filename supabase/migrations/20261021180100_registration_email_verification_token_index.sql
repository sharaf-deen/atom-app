-- One active token hash cannot identify multiple pending requests.
CREATE UNIQUE INDEX IF NOT EXISTS atom_public_registration_verification_token_hash_uidx
    ON public.atom_public_registration_requests (verification_token_hash)
    WHERE verification_token_hash IS NOT NULL;
