-- Functional 1D.1B.2E.2: record irreversible Auth intent BEFORE creating a user.
-- A started operation is NEVER automatically retried. Manual reconciliation required.
ALTER TABLE public.atom_public_registration_requests
  ADD COLUMN IF NOT EXISTS auth_provisioning_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS provisioned_auth_user_id uuid,
  ADD COLUMN IF NOT EXISTS auth_provisioning_recorded_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS atom_registration_provisioned_auth_user_unique
ON public.atom_public_registration_requests(provisioned_auth_user_id)
WHERE provisioned_auth_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.atom_begin_registration_auth_v1(p_request_id uuid, p_claim_id uuid)
RETURNS TABLE(started boolean, reason text, account_email text, is_minor boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row public.atom_public_registration_requests%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_claim_id IS NULL THEN
   RETURN QUERY SELECT false, 'INVALID_IDENTIFIERS'::text, NULL::text, NULL::boolean; RETURN;
 END IF;
 SELECT * INTO v_row FROM public.atom_public_registration_requests
   WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND OR v_row.status IS DISTINCT FROM 'provisioning'
    OR v_row.provisioning_claim_id IS DISTINCT FROM p_claim_id
    OR v_row.auth_provisioning_started_at IS NOT NULL
    OR v_row.provisioned_auth_user_id IS NOT NULL
    OR v_row.identity_verified_at IS NULL
    OR lower(btrim(v_row.verified_account_email)) IS DISTINCT FROM lower(btrim(v_row.account_email))
    OR v_row.expires_at <= clock_timestamp()
    OR v_row.member_user_id IS NOT NULL OR v_row.family_id IS NOT NULL THEN
   RETURN QUERY SELECT false, 'NOT_READY_OR_ALREADY_STARTED'::text, NULL::text, NULL::boolean; RETURN;
 END IF;
 UPDATE public.atom_public_registration_requests
 SET auth_provisioning_started_at=clock_timestamp(), updated_at=clock_timestamp()
 WHERE id=p_request_id;
 RETURN QUERY SELECT true, 'STARTED'::text, v_row.account_email, v_row.is_minor;
END; $$;

CREATE OR REPLACE FUNCTION public.atom_record_registration_auth_v1(
 p_request_id uuid, p_claim_id uuid, p_auth_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_email text; v_auth_email text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_auth_user_id IS NULL THEN RETURN false; END IF;
 SELECT account_email INTO v_email FROM public.atom_public_registration_requests
 WHERE id=p_request_id AND status='provisioning' AND provisioning_claim_id=p_claim_id
   AND auth_provisioning_started_at IS NOT NULL
   AND provisioned_auth_user_id IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT email INTO v_auth_email FROM auth.users WHERE id=p_auth_user_id;
 IF v_auth_email IS NULL OR lower(btrim(v_auth_email)) IS DISTINCT FROM lower(btrim(v_email)) THEN
   RETURN false;
 END IF;
 UPDATE public.atom_public_registration_requests
 SET provisioned_auth_user_id=p_auth_user_id, auth_provisioning_recorded_at=clock_timestamp(),
     updated_at=clock_timestamp()
 WHERE id=p_request_id;
 RETURN true;
END; $$;

REVOKE ALL ON FUNCTION public.atom_begin_registration_auth_v1(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.atom_record_registration_auth_v1(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atom_begin_registration_auth_v1(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.atom_record_registration_auth_v1(uuid,uuid,uuid) TO service_role;
