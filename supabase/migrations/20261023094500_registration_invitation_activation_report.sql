-- 1D.1B.2E.5B first stage: advisory checkpoint (not proof of verified password, email delivery, or consent).
ALTER TABLE public.atom_public_registration_requests
  ADD COLUMN IF NOT EXISTS password_setup_reported_at timestamptz;

CREATE OR REPLACE FUNCTION public.atom_report_registration_password_setup_v1(p_auth_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.atom_public_registration_requests%ROWTYPE;
DECLARE a auth.users%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_auth_user_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO a FROM auth.users WHERE id = p_auth_user_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO r FROM public.atom_public_registration_requests
    WHERE provisioned_auth_user_id = p_auth_user_id
      AND status = 'invitation_pending'
      AND invitation_dispatched_at IS NOT NULL
      AND invitation_email_id IS NOT NULL
      AND invitation_dispatch_started_at IS NOT NULL
      AND auth_provisioning_recorded_at IS NOT NULL
      AND identity_verified_at IS NOT NULL
      AND lower(btrim(verified_account_email)) = lower(btrim(account_email))
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF a.raw_app_meta_data->>'atom_registration_request_id' IS DISTINCT FROM r.id::text
     OR a.raw_app_meta_data->>'atom_registration_claim_id' IS DISTINCT FROM r.provisioning_claim_id::text
     OR lower(btrim(coalesce(a.email,''))) IS DISTINCT FROM lower(btrim(r.account_email)) THEN
    RETURN false;
  END IF;
  UPDATE public.atom_public_registration_requests
    SET password_setup_reported_at = coalesce(password_setup_reported_at,clock_timestamp()),
        updated_at = clock_timestamp()
    WHERE id = r.id;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.atom_report_registration_password_setup_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atom_report_registration_password_setup_v1(uuid) TO service_role;
