-- Functional 1D.1B.1: durable staging for unverified public registration requests.
-- No member, family, Auth account, subscription or legal acceptance is created here.
CREATE TABLE IF NOT EXISTS public.atom_public_registration_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_key uuid NOT NULL UNIQUE,
    account_email text NOT NULL,
    participant_first_name text NOT NULL,
    participant_last_name text NOT NULL,
    participant_date_of_birth date NOT NULL,
    selected_program_key text NOT NULL,
    participant_phone text,
    guardian_full_name text,
    guardian_email text,
    guardian_relationship text,
    is_minor boolean NOT NULL,
    -- Captures selections ONLY. Not a member_legal_acceptances record or signature.
    claimed_document_version_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
    status text NOT NULL DEFAULT 'pending_verification',
    submitted_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
    processed_at timestamptz,
    member_user_id uuid,
    family_id uuid,
    last_error_code text,
    CONSTRAINT atom_public_registration_requests_status_check CHECK (
      status IN ('pending_verification','under_review','provisioning','invitation_pending','completed','rejected','expired','failed')
    ),
    CONSTRAINT atom_public_registration_requests_names_check CHECK (
      char_length(btrim(participant_first_name)) BETWEEN 2 AND 100 AND
      char_length(btrim(participant_last_name)) BETWEEN 2 AND 100
    ),
    CONSTRAINT atom_public_registration_requests_account_email_check CHECK (
      char_length(account_email) BETWEEN 3 AND 254 AND account_email = lower(btrim(account_email))
    ),
    CONSTRAINT atom_public_registration_requests_minor_guardian_check CHECK (
      (NOT is_minor AND guardian_full_name IS NULL AND guardian_email IS NULL AND guardian_relationship IS NULL)
      OR (is_minor AND guardian_full_name IS NOT NULL AND char_length(btrim(guardian_full_name)) BETWEEN 2 AND 200 AND guardian_email IS NOT NULL AND guardian_relationship IS NOT NULL AND guardian_relationship IN ('mother','father','legal_guardian') AND account_email = guardian_email)
    ),
    CONSTRAINT atom_public_registration_requests_expiry_check CHECK (expires_at > submitted_at),
    CONSTRAINT atom_public_registration_requests_member_fk FOREIGN KEY (member_user_id) REFERENCES public.profiles(user_id) ON DELETE RESTRICT
);
