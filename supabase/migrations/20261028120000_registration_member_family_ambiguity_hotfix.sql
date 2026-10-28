-- A04.4 hotfix: qualify family_members.member_id to avoid PL/pgSQL OUT parameter ambiguity (SQLSTATE 42702).
-- Replaces function definition only; no member, family or request data mutation.
-- Source: 20261022120000_registration_member_family_atomic.sql, with one qualified identifier.
-- Functional 1D.1B.2E.4: atomic, service-only, provenance-checked Member / Family core.
-- Invitation, legal acceptance evidence, enrollment and subscriptions are OUT OF SCOPE.
-- A request can transition only once from provisioning to invitation_pending.
CREATE OR REPLACE FUNCTION public.atom_complete_registration_member_family_v1(
  p_request_id uuid, p_claim_id uuid, p_actor_id uuid
) RETURNS TABLE(ok boolean, code text, member_id uuid, created_family_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r public.atom_public_registration_requests%ROWTYPE;
  a auth.users%ROWTYPE;
  v_member uuid;
  v_family uuid;
  v_family_name text;
  v_given text;
  v_surname text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF p_request_id IS NULL OR p_claim_id IS NULL OR p_actor_id IS NULL THEN
    RETURN QUERY SELECT false, 'INVALID_IDENTIFIERS'::text, null::uuid, null::uuid; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=p_actor_id AND p.role='super_admin') THEN
    RETURN QUERY SELECT false, 'ACTOR_NOT_AUTHORIZED'::text, null::uuid, null::uuid; RETURN;
  END IF;
  SELECT * INTO r FROM public.atom_public_registration_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'REQUEST_NOT_FOUND'::text, null::uuid, null::uuid; RETURN;
  END IF;
  IF r.status = 'invitation_pending' AND r.provisioning_claim_id=p_claim_id AND r.member_user_id IS NOT NULL THEN
    RETURN QUERY SELECT true, 'ALREADY_PERSISTED'::text, r.member_user_id, r.family_id; RETURN;
  END IF;
  IF r.status IS DISTINCT FROM 'provisioning' OR r.provisioning_claim_id IS DISTINCT FROM p_claim_id
     OR r.provisioned_auth_user_id IS NULL OR r.auth_provisioning_started_at IS NULL
     OR r.auth_provisioning_recorded_at IS NULL OR r.member_user_id IS NOT NULL OR r.family_id IS NOT NULL
     OR r.identity_verified_at IS NULL
     OR lower(btrim(r.verified_account_email)) IS DISTINCT FROM lower(btrim(r.account_email)) THEN
    RETURN QUERY SELECT false, 'REQUEST_NOT_READY'::text, null::uuid, null::uuid; RETURN;
  END IF;
  -- Account provenance must be guaranteed by trusted server-created app_metadata.
  SELECT * INTO a FROM auth.users WHERE id=r.provisioned_auth_user_id FOR UPDATE;
  IF NOT FOUND OR lower(btrim(coalesce(a.email,''))) IS DISTINCT FROM lower(btrim(r.account_email))
     OR a.raw_app_meta_data->>'atom_registration_request_id' IS DISTINCT FROM p_request_id::text
     OR a.raw_app_meta_data->>'atom_registration_claim_id' IS DISTINCT FROM p_claim_id::text THEN
    RETURN QUERY SELECT false, 'AUTH_PROVENANCE_MISMATCH'::text, null::uuid, null::uuid; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.atom_public_registration_requests x
     WHERE x.id<>r.id AND x.provisioned_auth_user_id=a.id) THEN
    RETURN QUERY SELECT false, 'AUTH_ALREADY_USED'::text, null::uuid, null::uuid; RETURN;
  END IF;
  IF r.is_minor AND (r.guardian_email IS NULL OR lower(btrim(r.guardian_email)) IS DISTINCT FROM lower(btrim(r.account_email))
     OR r.guardian_full_name IS NULL OR btrim(r.guardian_full_name)='' OR r.guardian_relationship NOT IN ('mother','father','legal_guardian')) THEN
    RETURN QUERY SELECT false, 'GUARDIAN_REQUEST_NOT_VERIFIED'::text, null::uuid, null::uuid; RETURN;
  END IF;
  IF NOT r.is_minor THEN
    -- Auth signup trigger may have created the bare Member profile: complete ONLY
    -- if it is unclaimed, role=member, and no personal fields were populated.
    IF EXISTS (SELECT 1 FROM public.family_guardians WHERE auth_user_id=a.id) THEN
      RETURN QUERY SELECT false, 'AUTH_ALREADY_GUARDIAN'::text, null::uuid, null::uuid; RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=a.id
       AND p.role='member' AND p.first_name IS NULL AND p.last_name IS NULL
       AND p.date_of_birth IS NULL AND (p.email IS NULL OR lower(btrim(p.email))=lower(btrim(r.account_email)))) THEN
      RETURN QUERY SELECT false, 'PROFILE_NOT_EMPTY_OR_MISSING'::text, null::uuid, null::uuid; RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.member_id=a.id) THEN
      RETURN QUERY SELECT false, 'MEMBER_ALREADY_IN_FAMILY'::text, null::uuid, null::uuid; RETURN;
    END IF;
    UPDATE public.profiles p
    SET first_name=r.participant_first_name,
        last_name=r.participant_last_name,
        date_of_birth=r.participant_date_of_birth,
        phone=coalesce(p.phone,r.participant_phone)
    WHERE p.user_id=a.id;
    v_member := a.id;
  ELSE
    -- Parent Auth must NOT have a Member profile. The Auth create step now
    -- supplies account_type=family_parent to suppress the signup trigger.
    -- Legacy ambiguous parent Auth accounts must be reviewed manually.
    IF a.raw_user_meta_data->>'account_type' IS DISTINCT FROM 'family_parent' THEN
      RETURN QUERY SELECT false, 'PARENT_AUTH_TYPE_NOT_VERIFIED'::text, null::uuid, null::uuid; RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id=a.id)
       OR EXISTS (SELECT 1 FROM public.family_guardians WHERE auth_user_id=a.id) THEN
      RETURN QUERY SELECT false, 'PARENT_AUTH_ALREADY_LINKED'::text, null::uuid, null::uuid; RETURN;
    END IF;
    -- Fail closed on existing dependent profiles matching the same child identity.
    IF EXISTS (SELECT 1 FROM public.profiles p
        WHERE p.date_of_birth=r.participant_date_of_birth
          AND lower(btrim(coalesce(p.first_name,'')))=lower(btrim(r.participant_first_name))
          AND lower(btrim(coalesce(p.last_name,'')))=lower(btrim(r.participant_last_name))) THEN
      RETURN QUERY SELECT false, 'POSSIBLE_EXISTING_CHILD_REVIEW_REQUIRED'::text, null::uuid, null::uuid; RETURN;
    END IF;
    v_family_name := left(coalesce(nullif(btrim(r.guardian_full_name),''),r.participant_last_name) || ' Family',120);
    INSERT INTO public.families(name,created_by) VALUES(v_family_name,p_actor_id) RETURNING id INTO v_family;
    -- Parent name is display-only; no automated assertion of relationship beyond
    -- the verified account plus request provenance and staff-controlled approval.
    v_given := split_part(btrim(r.guardian_full_name),' ',1);
    v_surname := nullif(btrim(substr(btrim(r.guardian_full_name),length(v_given)+1)), '');
    INSERT INTO public.family_guardians
      (family_id,auth_user_id,email,first_name,last_name,relationship,is_primary,created_by)
    VALUES (v_family,a.id,r.account_email,v_given,v_surname,
      CASE r.guardian_relationship WHEN 'mother' THEN 'mother' WHEN 'father' THEN 'father' ELSE 'guardian' END,
      true,p_actor_id);
    v_member := gen_random_uuid();
    INSERT INTO public.profiles
      (user_id,email,first_name,last_name,date_of_birth,phone,role,qr_code)
    VALUES (v_member,NULL,r.participant_first_name,r.participant_last_name,
      r.participant_date_of_birth,r.participant_phone,'member','atom:'||v_member::text);
    INSERT INTO public.family_members(family_id,member_id,added_by) VALUES(v_family,v_member,p_actor_id);
  END IF;
  UPDATE public.atom_public_registration_requests
     SET member_user_id=v_member,family_id=v_family,status='invitation_pending',
         processed_at=clock_timestamp(),updated_at=clock_timestamp(),last_error_code=NULL
   WHERE id=r.id;
  RETURN QUERY SELECT true, 'PERSISTED_INVITATION_NOT_SENT'::text,v_member,v_family;
END; $$;
REVOKE ALL ON FUNCTION public.atom_complete_registration_member_family_v1(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atom_complete_registration_member_family_v1(uuid,uuid,uuid) TO service_role;
