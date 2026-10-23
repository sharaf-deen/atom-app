-- E.5C: immutable invitation resend attempts; ambiguous attempts require manual investigation.
CREATE TABLE IF NOT EXISTS public.atom_registration_invitation_resend_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL REFERENCES public.atom_public_registration_requests(id),
 claim_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 12 AND 1000),
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 provider_email_id text,
 recorded_at timestamptz,
 CONSTRAINT invitation_resend_receipt_pair CHECK ((provider_email_id IS NULL) = (recorded_at IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_registration_resend_request ON public.atom_registration_invitation_resend_attempts(request_id,started_at DESC);
ALTER TABLE public.atom_registration_invitation_resend_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.atom_registration_invitation_resend_attempts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.atom_registration_invitation_resend_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.atom_begin_registration_invitation_resend_v1(
 p_request_id uuid, p_claim_id uuid, p_actor_id uuid, p_reason text
) RETURNS TABLE(ok boolean, code text, attempt_id uuid, account_email text, auth_user_id uuid, is_minor boolean, member_user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.atom_public_registration_requests%ROWTYPE; a auth.users%ROWTYPE; last_attempt public.atom_registration_invitation_resend_attempts%ROWTYPE; total int; new_id uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=p_actor_id AND p.role='super_admin') THEN
  RETURN QUERY SELECT false,'FORBIDDEN'::text,null::uuid,null::text,null::uuid,null::boolean,null::uuid; RETURN;
 END IF;
 IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 12 AND 1000 THEN
  RETURN QUERY SELECT false,'INVALID_REASON'::text,null::uuid,null::text,null::uuid,null::boolean,null::uuid; RETURN;
 END IF;
 SELECT * INTO r FROM public.atom_public_registration_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND THEN RETURN QUERY SELECT false,'NOT_FOUND'::text,null::uuid,null::text,null::uuid,null::boolean,null::uuid; RETURN; END IF;
 IF r.status <> 'invitation_pending' OR r.provisioning_claim_id IS DISTINCT FROM p_claim_id
  OR r.provisioned_auth_user_id IS NULL OR r.member_user_id IS NULL OR r.auth_provisioning_recorded_at IS NULL
  OR r.identity_verified_at IS NULL OR lower(btrim(r.verified_account_email)) IS DISTINCT FROM lower(btrim(r.account_email))
  OR r.invitation_dispatched_at IS NULL OR r.invitation_email_id IS NULL OR r.password_setup_reported_at IS NOT NULL
  OR (r.is_minor AND r.family_id IS NULL) OR (NOT r.is_minor AND r.family_id IS NOT NULL) THEN
   RETURN QUERY SELECT false,'NOT_ELIGIBLE'::text,null::uuid,null::text,null::uuid,null::boolean,null::uuid; RETURN;
 END IF;
 SELECT * INTO a FROM auth.users WHERE id=r.provisioned_auth_user_id;
 IF NOT FOUND OR lower(btrim(a.email)) IS DISTINCT FROM lower(btrim(r.account_email))
  OR a.raw_app_meta_data->>'atom_registration_request_id' IS DISTINCT FROM p_request_id::text
  OR a.raw_app_meta_data->>'atom_registration_claim_id' IS DISTINCT FROM p_claim_id::text
  OR a.last_sign_in_at IS NOT NULL THEN
  RETURN QUERY SELECT false,'AUTH_NOT_ELIGIBLE'::text,null::uuid,null::text,null::uuid,null::boolean,null::uuid; RETURN;
 END IF;
 IF r.is_minor AND NOT EXISTS (SELECT 1 FROM public.family_guardians g WHERE g.family_id=r.family_id AND g.auth_user_id=a.id AND g.is_primary=true) THEN
  RETURN QUERY SELECT false,'GUARDIAN_MISMATCH'::text,null::uuid,null::text,null::uuid,null::boolean,null::uuid; RETURN;
 END IF;
 IF NOT r.is_minor AND r.member_user_id IS DISTINCT FROM a.id THEN
  RETURN QUERY SELECT false,'MEMBER_AUTH_MISMATCH'::text,null::uuid,null::text,null::uuid,null::boolean,null::uuid; RETURN;
 END IF;
 SELECT count(*) INTO total FROM public.atom_registration_invitation_resend_attempts WHERE request_id=p_request_id;
 IF total >= 3 THEN RETURN QUERY SELECT false,'RESEND_LIMIT_REACHED'::text,null::uuid,null::text,null::uuid,null::boolean,null::uuid; RETURN; END IF;
 SELECT * INTO last_attempt FROM public.atom_registration_invitation_resend_attempts WHERE request_id=p_request_id ORDER BY started_at DESC LIMIT 1;
 IF FOUND AND (last_attempt.recorded_at IS NULL OR last_attempt.started_at > clock_timestamp()-interval '15 minutes') THEN
  RETURN QUERY SELECT false,'RESEND_LOCKED_OR_COOLDOWN'::text,null::uuid,null::text,null::uuid,null::boolean,null::uuid; RETURN;
 END IF;
 IF r.invitation_dispatched_at > clock_timestamp()-interval '15 minutes' THEN
  RETURN QUERY SELECT false,'INITIAL_COOLDOWN'::text,null::uuid,null::text,null::uuid,null::boolean,null::uuid; RETURN;
 END IF;
 INSERT INTO public.atom_registration_invitation_resend_attempts(request_id,claim_id,actor_id,reason)
 VALUES(p_request_id,p_claim_id,p_actor_id,btrim(p_reason)) RETURNING id INTO new_id;
 RETURN QUERY SELECT true,'RESEND_RESERVED'::text,new_id,r.account_email,r.provisioned_auth_user_id,r.is_minor,r.member_user_id;
END; $$;
REVOKE ALL ON FUNCTION public.atom_begin_registration_invitation_resend_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.atom_begin_registration_invitation_resend_v1(uuid,uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.atom_record_registration_invitation_resend_v1(
 p_attempt_id uuid,p_request_id uuid,p_claim_id uuid,p_actor_id uuid,p_provider_email_id text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_provider_email_id IS NULL OR btrim(p_provider_email_id)='' OR length(p_provider_email_id)>512 THEN RETURN false; END IF;
 UPDATE public.atom_registration_invitation_resend_attempts SET provider_email_id=p_provider_email_id,recorded_at=clock_timestamp()
 WHERE id=p_attempt_id AND request_id=p_request_id AND claim_id=p_claim_id AND actor_id=p_actor_id AND recorded_at IS NULL;
 RETURN FOUND;
END; $$;
REVOKE ALL ON FUNCTION public.atom_record_registration_invitation_resend_v1(uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.atom_record_registration_invitation_resend_v1(uuid,uuid,uuid,uuid,text) TO service_role;
