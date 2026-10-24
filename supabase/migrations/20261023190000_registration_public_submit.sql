-- Public submission is executed ONLY by the server's service-role client.
-- Hashes use a private HMAC secret; never store the remote IP address.
ALTER TABLE public.atom_public_registration_requests
  ADD COLUMN IF NOT EXISTS submission_ip_hash text;
CREATE INDEX IF NOT EXISTS atom_registration_submit_ip_time_idx
 ON public.atom_public_registration_requests(submission_ip_hash, submitted_at DESC)
 WHERE submission_ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS atom_registration_submit_email_time_idx
 ON public.atom_public_registration_requests(account_email, submitted_at DESC);

CREATE OR REPLACE FUNCTION public.atom_submit_public_registration_v1(
 p_request_key uuid,
 p_account_email text,
 p_first_name text,
 p_last_name text,
 p_date_of_birth date,
 p_program_key text,
 p_phone text,
 p_guardian_name text,
 p_guardian_email text,
 p_guardian_relationship text,
 p_is_minor boolean,
 p_doc_ids uuid[],
 p_ip_hash text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_existing public.atom_public_registration_requests%ROWTYPE;
BEGIN
 IF p_request_key IS NULL OR p_account_email IS NULL OR p_ip_hash !~ '^[a-f0-9]{64}$' THEN
   RETURN 'rejected';
 END IF;
 -- Serializes concurrent submissions for the same account and source.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_account_email, 9103));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_ip_hash, 9104));
 SELECT * INTO v_existing FROM public.atom_public_registration_requests
   WHERE request_key = p_request_key;
 IF FOUND THEN
   -- Do not expose whether this key belongs to another account.
   RETURN CASE WHEN v_existing.account_email=p_account_email THEN 'accepted' ELSE 'rejected' END;
 END IF;
 IF EXISTS (
   SELECT 1 FROM public.atom_public_registration_requests
   WHERE account_email = p_account_email AND submitted_at > now()-interval '20 minutes'
 ) OR (
   SELECT count(*) FROM public.atom_public_registration_requests
   WHERE account_email=p_account_email AND submitted_at > now()-interval '24 hours'
 ) >= 3 OR (
   SELECT count(*) FROM public.atom_public_registration_requests
   WHERE submission_ip_hash=p_ip_hash AND submitted_at > now()-interval '1 hour'
 ) >= 5 OR (
   SELECT count(*) FROM public.atom_public_registration_requests
   WHERE submission_ip_hash=p_ip_hash AND submitted_at > now()-interval '24 hours'
 ) >= 12 THEN
   RETURN 'limited';
 END IF;
 INSERT INTO public.atom_public_registration_requests (
   request_key,account_email,participant_first_name,participant_last_name,
   participant_date_of_birth,selected_program_key,participant_phone,
   guardian_full_name,guardian_email,guardian_relationship,is_minor,
   claimed_document_version_ids,submission_ip_hash
 ) VALUES (
   p_request_key,p_account_email,p_first_name,p_last_name,
   p_date_of_birth,p_program_key,p_phone,
   p_guardian_name,p_guardian_email,p_guardian_relationship,p_is_minor,
   p_doc_ids,p_ip_hash
 );
 RETURN 'accepted';
EXCEPTION WHEN unique_violation THEN
 RETURN 'rejected';
END;
$$;
REVOKE ALL ON FUNCTION public.atom_submit_public_registration_v1(uuid,text,text,text,date,text,text,text,text,text,boolean,uuid[],text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atom_submit_public_registration_v1(uuid,text,text,text,date,text,text,text,text,text,boolean,uuid[],text) TO service_role;
