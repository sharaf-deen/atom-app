-- F07.2C — Transactional guardian legal acceptance, Staging first.
-- Run AFTER F07.2A. No existing consent or review records are rewritten.
-- The advisory lock is taken BOTH by review INSERT and guardian acceptance.
-- A review committed before acceptance's lock is considered; a concurrent
-- review that starts later must wait for the acceptance transaction to finish.

CREATE OR REPLACE FUNCTION public.atom_f07_2c_lock_new_guardian_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      NEW.family_id::text || ':' || NEW.guardian_auth_user_id::text || ':' || NEW.member_user_id::text,
      0
    )
  );
  -- Review order must reflect serialization, not transaction start time.
  NEW.reviewed_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.atom_f07_2c_lock_new_guardian_review() FROM PUBLIC;
DROP TRIGGER IF EXISTS atom_f07_2c_lock_review_insert
  ON public.atom_guardian_authority_reviews;
CREATE TRIGGER atom_f07_2c_lock_review_insert
BEFORE INSERT ON public.atom_guardian_authority_reviews
FOR EACH ROW EXECUTE FUNCTION public.atom_f07_2c_lock_new_guardian_review();

CREATE OR REPLACE FUNCTION public.atom_record_verified_guardian_legal_acceptances_v1(
  p_registration_request_id uuid,
  p_family_id uuid,
  p_guardian_auth_user_id uuid,
  p_member_user_id uuid,
  p_document_version_ids uuid[],
  p_acceptor_name text,
  p_acceptor_capacity text,
  p_guardian_relationship text,
  p_user_agent text DEFAULT NULL,
  p_ip_address text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request_found boolean := false;
  v_relationship text;
  v_guardian_name text;
  v_latest_decision text;
  v_age integer;
BEGIN
  -- PostgREST may only invoke this RPC with the service-role JWT; the
  -- application server already authenticates and binds the guardian user.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'GUARDIAN_CONSENT_SERVICE_ROLE_REQUIRED';
  END IF;

  IF p_registration_request_id IS NULL OR p_family_id IS NULL
     OR p_guardian_auth_user_id IS NULL OR p_member_user_id IS NULL THEN
    RAISE EXCEPTION 'GUARDIAN_CONSENT_INVALID_IDENTIFIERS';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_family_id::text || ':' || p_guardian_auth_user_id::text || ':' || p_member_user_id::text,
      0
    )
  );

  -- Reverify the exact completed minor registration inside this transaction.
  SELECT TRUE INTO v_request_found
  FROM public.atom_public_registration_requests r
  WHERE r.id = p_registration_request_id
    AND r.status = 'completed'
    AND r.is_minor = TRUE
    AND r.account_activated_at IS NOT NULL
    AND r.family_id = p_family_id
    AND r.provisioned_auth_user_id = p_guardian_auth_user_id
    AND r.member_user_id = p_member_user_id
  FOR SHARE;
  IF COALESCE(v_request_found, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'GUARDIAN_REGISTRATION_BINDING_INVALID';
  END IF;

  SELECT fg.relationship,
         pg_catalog.btrim(pg_catalog.concat_ws(' ', fg.first_name, fg.last_name))
    INTO v_relationship, v_guardian_name
  FROM public.family_guardians fg
  WHERE fg.family_id = p_family_id
    AND fg.auth_user_id = p_guardian_auth_user_id
  FOR SHARE;

  IF NOT FOUND OR v_relationship NOT IN
      ('mother','father','parent','guardian','legal_guardian') THEN
    RAISE EXCEPTION 'GUARDIAN_RELATIONSHIP_INVALID';
  END IF;

  PERFORM 1 FROM public.family_members fm
   WHERE fm.family_id = p_family_id AND fm.member_id = p_member_user_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GUARDIAN_CHILD_LINK_NOT_FOUND';
  END IF;

  SELECT EXTRACT(YEAR FROM AGE(
    (pg_catalog.now() AT TIME ZONE 'Africa/Cairo')::date, p.date_of_birth))::integer
  INTO v_age
  FROM public.profiles p
  WHERE p.user_id = p_member_user_id AND p.role = 'member'
  FOR SHARE;
  IF v_age IS NULL OR v_age < 0 OR v_age >= 18 THEN
    RAISE EXCEPTION 'GUARDIAN_MEMBER_NOT_MINOR';
  END IF;

  IF pg_catalog.lower(pg_catalog.btrim(COALESCE(p_acceptor_name,''))) <>
      pg_catalog.lower(COALESCE(v_guardian_name,'')) OR
     pg_catalog.length(v_guardian_name) < 2 THEN
    RAISE EXCEPTION 'GUARDIAN_SIGNER_NAME_MISMATCH';
  END IF;

  IF p_guardian_relationship IS DISTINCT FROM v_relationship OR
     p_acceptor_capacity IS DISTINCT FROM
       (CASE WHEN v_relationship IN ('guardian','legal_guardian')
             THEN 'legal_guardian' ELSE 'parent' END) THEN
    RAISE EXCEPTION 'GUARDIAN_CAPACITY_MISMATCH';
  END IF;

  SELECT ar.decision INTO v_latest_decision
  FROM public.atom_guardian_authority_reviews ar
  WHERE ar.family_id = p_family_id
    AND ar.guardian_auth_user_id = p_guardian_auth_user_id
    AND ar.member_user_id = p_member_user_id
  ORDER BY ar.reviewed_at DESC, ar.id DESC
  LIMIT 1;
  IF COALESCE(v_latest_decision,'requires_review') <> 'verified' THEN
    RAISE EXCEPTION 'GUARDIAN_AUTHORITY_REVIEW_REQUIRED';
  END IF;

  -- Existing function performs the legal-document/version validations and
  -- inserts snapshots. Both checks and inserts are in THIS transaction.
  RETURN public.record_member_legal_acceptances_v1(
    p_member_user_id := p_member_user_id,
    p_document_version_ids := p_document_version_ids,
    p_acceptor_name := p_acceptor_name,
    p_acceptor_capacity := p_acceptor_capacity,
    p_guardian_relationship := p_guardian_relationship,
    p_recorded_by_user_id := p_guardian_auth_user_id,
    p_source := 'profile_reaccept',
    p_user_agent := p_user_agent,
    p_ip_address := p_ip_address
  );
END;
$$;
REVOKE ALL ON FUNCTION public.atom_record_verified_guardian_legal_acceptances_v1(
  uuid,uuid,uuid,uuid,uuid[],text,text,text,text,text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atom_record_verified_guardian_legal_acceptances_v1(
  uuid,uuid,uuid,uuid,uuid[],text,text,text,text,text
) TO service_role;
