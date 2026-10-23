-- Functional 1D.1B.2E.5D: server-confirmed password update and account binding.
-- This confirms technical activation only; it does NOT grant legal consent or membership.
ALTER TABLE public.atom_public_registration_requests
  ADD COLUMN IF NOT EXISTS account_activated_at timestamptz;

CREATE OR REPLACE FUNCTION public.atom_finalize_registration_activation_v1(p_auth_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.atom_public_registration_requests%ROWTYPE;
DECLARE a auth.users%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF p_auth_user_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO r FROM public.atom_public_registration_requests
    WHERE provisioned_auth_user_id=p_auth_user_id
      AND status IN ('invitation_pending','completed')
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF r.status='completed' THEN
    RETURN r.account_activated_at IS NOT NULL;
  END IF;
  IF r.provisioning_claim_id IS NULL OR r.identity_verified_at IS NULL
     OR r.auth_provisioning_recorded_at IS NULL OR r.member_user_id IS NULL
     OR r.invitation_dispatch_started_at IS NULL OR r.invitation_dispatched_at IS NULL
     OR r.invitation_email_id IS NULL
     OR lower(btrim(r.verified_account_email)) IS DISTINCT FROM lower(btrim(r.account_email)) THEN
    RETURN false;
  END IF;
  SELECT * INTO a FROM auth.users WHERE id=p_auth_user_id;
  IF NOT FOUND OR lower(btrim(coalesce(a.email,''))) IS DISTINCT FROM lower(btrim(r.account_email))
     OR a.raw_app_meta_data->>'atom_registration_request_id' IS DISTINCT FROM r.id::text
     OR a.raw_app_meta_data->>'atom_registration_claim_id' IS DISTINCT FROM r.provisioning_claim_id::text THEN
    RETURN false;
  END IF;
  IF r.is_minor THEN
    IF r.family_id IS NULL OR a.raw_user_meta_data->>'account_type' IS DISTINCT FROM 'family_parent'
      OR NOT EXISTS(SELECT 1 FROM public.family_guardians g
          WHERE g.family_id=r.family_id AND g.auth_user_id=a.id AND g.is_primary=true)
      OR NOT EXISTS(SELECT 1 FROM public.family_members m
          WHERE m.family_id=r.family_id AND m.member_id=r.member_user_id)
      OR NOT EXISTS(SELECT 1 FROM public.profiles p
          WHERE p.user_id=r.member_user_id AND p.role='member') THEN
      RETURN false;
    END IF;
  ELSE
    IF r.family_id IS NOT NULL OR r.member_user_id IS DISTINCT FROM a.id
      OR NOT EXISTS(SELECT 1 FROM public.profiles p
          WHERE p.user_id=a.id AND p.role='member') THEN
      RETURN false;
    END IF;
  END IF;
  UPDATE public.atom_public_registration_requests
     SET status='completed', account_activated_at=clock_timestamp(),
         updated_at=clock_timestamp()
    WHERE id=r.id AND status='invitation_pending';
  RETURN FOUND;
END; $$;
REVOKE ALL ON FUNCTION public.atom_finalize_registration_activation_v1(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.atom_finalize_registration_activation_v1(uuid) TO service_role;
