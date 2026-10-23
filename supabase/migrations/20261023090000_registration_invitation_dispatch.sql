-- E.5: permanently reserve one invitation dispatch; uncertain provider outcomes require review.
ALTER TABLE public.atom_public_registration_requests
  ADD COLUMN IF NOT EXISTS invitation_dispatch_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS invitation_dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS invitation_email_id text,
  ADD COLUMN IF NOT EXISTS invitation_dispatch_actor_id uuid;

CREATE OR REPLACE FUNCTION public.atom_begin_registration_invitation_v1(
 p_request_id uuid, p_claim_id uuid, p_actor_id uuid
) RETURNS TABLE(ok boolean, code text, account_email text, auth_user_id uuid, is_minor boolean, member_user_id uuid, family_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.atom_public_registration_requests%ROWTYPE; a auth.users%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=p_actor_id AND p.role='super_admin') THEN
   RETURN QUERY SELECT false,'ACTOR_FORBIDDEN'::text,null::text,null::uuid,null::boolean,null::uuid,null::uuid; RETURN;
 END IF;
 SELECT * INTO r FROM public.atom_public_registration_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND THEN RETURN QUERY SELECT false,'NOT_FOUND'::text,null::text,null::uuid,null::boolean,null::uuid,null::uuid; RETURN; END IF;
 IF r.status <> 'invitation_pending' OR r.provisioning_claim_id IS DISTINCT FROM p_claim_id
    OR r.provisioned_auth_user_id IS NULL OR r.member_user_id IS NULL
    OR r.auth_provisioning_recorded_at IS NULL OR r.identity_verified_at IS NULL
    OR lower(btrim(r.verified_account_email)) IS DISTINCT FROM lower(btrim(r.account_email))
    OR (r.is_minor AND r.family_id IS NULL)
    OR (NOT r.is_minor AND r.family_id IS NOT NULL)
    OR r.invitation_dispatch_started_at IS NOT NULL THEN
   RETURN QUERY SELECT false,'NOT_READY_OR_ALREADY_ATTEMPTED'::text,null::text,null::uuid,null::boolean,null::uuid,null::uuid; RETURN;
 END IF;
 SELECT * INTO a FROM auth.users WHERE id=r.provisioned_auth_user_id;
 IF NOT FOUND OR lower(btrim(a.email)) IS DISTINCT FROM lower(btrim(r.account_email))
  OR a.raw_app_meta_data->>'atom_registration_request_id' IS DISTINCT FROM p_request_id::text
  OR a.raw_app_meta_data->>'atom_registration_claim_id' IS DISTINCT FROM p_claim_id::text
  OR a.last_sign_in_at IS NOT NULL THEN
   RETURN QUERY SELECT false,'AUTH_PROVENANCE_MISMATCH'::text,null::text,null::uuid,null::boolean,null::uuid,null::uuid; RETURN;
 END IF;
 IF r.is_minor AND NOT EXISTS (SELECT 1 FROM public.family_guardians g
    WHERE g.family_id=r.family_id AND g.auth_user_id=a.id AND g.is_primary=true) THEN
   RETURN QUERY SELECT false,'GUARDIAN_MISMATCH'::text,null::text,null::uuid,null::boolean,null::uuid,null::uuid; RETURN;
 END IF;
 IF NOT r.is_minor AND r.member_user_id IS DISTINCT FROM a.id THEN
   RETURN QUERY SELECT false,'MEMBER_AUTH_MISMATCH'::text,null::text,null::uuid,null::boolean,null::uuid,null::uuid; RETURN;
 END IF;
 UPDATE public.atom_public_registration_requests SET invitation_dispatch_started_at=clock_timestamp(),
 invitation_dispatch_actor_id=p_actor_id,updated_at=clock_timestamp() WHERE id=r.id;
 RETURN QUERY SELECT true,'DISPATCH_RESERVED'::text,r.account_email,r.provisioned_auth_user_id,r.is_minor,r.member_user_id,r.family_id;
END; $$;
REVOKE ALL ON FUNCTION public.atom_begin_registration_invitation_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.atom_begin_registration_invitation_v1(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.atom_record_registration_invitation_v1(
 p_request_id uuid, p_claim_id uuid, p_actor_id uuid, p_email_id text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_email_id IS NULL OR btrim(p_email_id)='' OR length(p_email_id)>512 THEN RETURN false; END IF;
 UPDATE public.atom_public_registration_requests
 SET invitation_dispatched_at=clock_timestamp(), invitation_email_id=p_email_id,updated_at=clock_timestamp()
 WHERE id=p_request_id AND provisioning_claim_id=p_claim_id AND invitation_dispatch_actor_id=p_actor_id
  AND invitation_dispatch_started_at IS NOT NULL AND invitation_dispatched_at IS NULL
  AND status='invitation_pending';
 RETURN FOUND;
END; $$;
REVOKE ALL ON FUNCTION public.atom_record_registration_invitation_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.atom_record_registration_invitation_v1(uuid,uuid,uuid,text) TO service_role;
