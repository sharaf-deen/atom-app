-- Functional 1D.1B.2E.3: only recover identities carrying matching original request/claim metadata.
-- No new Auth user, profile, family, payment, or consent is written by this migration.
CREATE TABLE IF NOT EXISTS public.atom_registration_auth_reconciliation_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 registration_request_id uuid NOT NULL REFERENCES public.atom_public_registration_requests(id) ON DELETE RESTRICT,
 auth_user_id uuid NOT NULL,
 claim_id uuid NOT NULL,
 actor_user_id uuid NOT NULL,
 reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 10 AND 1000),
 reconciled_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.atom_registration_auth_reconciliation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.atom_registration_auth_reconciliation_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.atom_registration_auth_reconciliation_audit TO service_role;

CREATE OR REPLACE FUNCTION public.atom_reconcile_registration_auth_v1(
 p_request_id uuid, p_claim_id uuid, p_auth_user_id uuid, p_actor_id uuid, p_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_request public.atom_public_registration_requests%ROWTYPE;
        v_auth auth.users%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
   RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF p_request_id IS NULL OR p_claim_id IS NULL OR p_auth_user_id IS NULL OR p_actor_id IS NULL
    OR char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 1000 THEN RETURN 'INVALID_INPUT'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id=p_actor_id AND role='super_admin')
    THEN RETURN 'ACTOR_NOT_AUTHORIZED'; END IF;
 SELECT * INTO v_request FROM public.atom_public_registration_requests
 WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND THEN RETURN 'REQUEST_NOT_FOUND'; END IF;
 IF v_request.provisioned_auth_user_id IS NOT NULL THEN
   IF v_request.provisioned_auth_user_id=p_auth_user_id THEN RETURN 'ALREADY_RECORDED'; END IF;
   RETURN 'DIFFERENT_AUTH_ALREADY_RECORDED';
 END IF;
 IF v_request.status IS DISTINCT FROM 'provisioning'
    OR v_request.provisioning_claim_id IS DISTINCT FROM p_claim_id
    OR v_request.auth_provisioning_started_at IS NULL
    OR v_request.member_user_id IS NOT NULL OR v_request.family_id IS NOT NULL
    OR v_request.identity_verified_at IS NULL
    OR lower(btrim(v_request.verified_account_email)) IS DISTINCT FROM lower(btrim(v_request.account_email))
 THEN RETURN 'NOT_ELIGIBLE'; END IF;
 SELECT * INTO v_auth FROM auth.users WHERE id=p_auth_user_id;
 IF NOT FOUND THEN RETURN 'AUTH_NOT_FOUND'; END IF;
 IF lower(btrim(coalesce(v_auth.email,''))) IS DISTINCT FROM lower(btrim(v_request.account_email))
    OR v_auth.raw_app_meta_data->>'atom_registration_request_id' IS DISTINCT FROM p_request_id::text
    OR v_auth.raw_app_meta_data->>'atom_registration_claim_id' IS DISTINCT FROM p_claim_id::text
 THEN RETURN 'AUTH_PROVENANCE_MISMATCH'; END IF;
 IF EXISTS (SELECT 1 FROM public.atom_public_registration_requests
   WHERE provisioned_auth_user_id=p_auth_user_id AND id<>p_request_id)
 THEN RETURN 'AUTH_ALREADY_USED'; END IF;
 IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id=p_auth_user_id)
    OR EXISTS (SELECT 1 FROM public.family_guardians WHERE auth_user_id=p_auth_user_id)
 THEN RETURN 'AUTH_ALREADY_LINKED'; END IF;
 -- A unique email match is not enough: require matching trusted Auth provenance above.
 UPDATE public.atom_public_registration_requests
 SET provisioned_auth_user_id=p_auth_user_id, auth_provisioning_recorded_at=clock_timestamp(), updated_at=clock_timestamp()
 WHERE id=p_request_id;
 INSERT INTO public.atom_registration_auth_reconciliation_audit
 (registration_request_id,auth_user_id,claim_id,actor_user_id,reason)
 VALUES (p_request_id,p_auth_user_id,p_claim_id,p_actor_id,btrim(p_reason));
 RETURN 'RECONCILED';
END; $$;
REVOKE ALL ON FUNCTION public.atom_reconcile_registration_auth_v1(uuid,uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atom_reconcile_registration_auth_v1(uuid,uuid,uuid,uuid,text) TO service_role;
