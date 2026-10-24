-- Functional 1D.1B.2F.4B.2A — immutable snapshots of PRE-VERIFICATION
-- legal-document selections. These are NOT member_legal_acceptances.
-- The authenticated, legally binding consent flow still needs a separate lot.
CREATE TABLE IF NOT EXISTS public.atom_registration_legal_claim_snapshots (
  request_id uuid NOT NULL REFERENCES public.atom_public_registration_requests(id) ON DELETE RESTRICT,
  document_version_id uuid NOT NULL REFERENCES public.legal_document_versions(id) ON DELETE RESTRICT,
  document_key_snapshot text NOT NULL,
  document_title_snapshot text NOT NULL,
  version_label_snapshot text NOT NULL,
  published_url_snapshot text NOT NULL,
  content_hash_snapshot text,
  claimed_at timestamptz NOT NULL,
  declared_signer_name text NOT NULL,
  declared_signer_capacity text NOT NULL CHECK (declared_signer_capacity IN ('participant','parent','legal_guardian')),
  declared_relationship text,
  identity_verified_at_snapshot timestamptz,
  evidence_level text NOT NULL DEFAULT 'unverified_submission' CHECK (evidence_level='unverified_submission'),
  PRIMARY KEY (request_id, document_version_id)
);
ALTER TABLE public.atom_registration_legal_claim_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.atom_registration_legal_claim_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.atom_registration_legal_claim_snapshots TO service_role;
-- Trigger executes with owner privileges, protected from direct public writes.
CREATE OR REPLACE FUNCTION public.atom_capture_registration_legal_claim_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  v_expected uuid[];
  v_given uuid[];
  v_signer text;
  v_capacity text;
BEGIN
  IF NEW.claimed_document_version_ids IS NULL OR
     cardinality(NEW.claimed_document_version_ids)=0 OR
     cardinality(NEW.claimed_document_version_ids)>10 THEN
    RAISE EXCEPTION 'REGISTRATION_REQUIRED_DOCUMENTS_MISSING';
  END IF;
  SELECT array_agg(id ORDER BY id) INTO v_expected
  FROM public.legal_document_versions
  WHERE status='active' AND is_required=true;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_given
  FROM unnest(NEW.claimed_document_version_ids) AS x;
  IF v_expected IS NULL OR v_expected IS DISTINCT FROM v_given OR
      cardinality(v_given)<>cardinality(NEW.claimed_document_version_ids) THEN
    RAISE EXCEPTION 'REGISTRATION_DOCUMENT_VERSIONS_STALE';
  END IF;
  v_signer := CASE WHEN NEW.is_minor THEN btrim(coalesce(NEW.guardian_full_name,''))
                   ELSE btrim(NEW.participant_first_name||' '||NEW.participant_last_name) END;
  v_capacity := CASE WHEN NOT NEW.is_minor THEN 'participant'
                     WHEN NEW.guardian_relationship='legal_guardian' THEN 'legal_guardian'
                     ELSE 'parent' END;
  IF char_length(v_signer)<2 OR char_length(v_signer)>200 THEN
    RAISE EXCEPTION 'REGISTRATION_SIGNER_DECLARATION_MISSING';
  END IF;
  INSERT INTO public.atom_registration_legal_claim_snapshots (
    request_id,document_version_id,document_key_snapshot,document_title_snapshot,
    version_label_snapshot,published_url_snapshot,content_hash_snapshot,claimed_at,
    declared_signer_name,declared_signer_capacity,declared_relationship
  )
  SELECT NEW.id,d.id,d.document_key,d.title,d.version_label,d.published_url,
         d.content_hash,NEW.submitted_at,v_signer,v_capacity,
         CASE WHEN NEW.is_minor THEN NEW.guardian_relationship ELSE NULL END
  FROM public.legal_document_versions d
  WHERE d.id=ANY(NEW.claimed_document_version_ids);
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS atom_capture_registration_legal_claim_after_insert
  ON public.atom_public_registration_requests;
CREATE TRIGGER atom_capture_registration_legal_claim_after_insert
AFTER INSERT ON public.atom_public_registration_requests
FOR EACH ROW EXECUTE FUNCTION public.atom_capture_registration_legal_claim_v1();
REVOKE ALL ON FUNCTION public.atom_capture_registration_legal_claim_v1() FROM PUBLIC, anon, authenticated;
-- Prevent silent rewriting/deletion of submitted snapshots, including via service_role.
CREATE OR REPLACE FUNCTION public.atom_reject_registration_legal_claim_mutation_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  RAISE EXCEPTION 'REGISTRATION_LEGAL_CLAIM_IS_IMMUTABLE';
END; $$;
DROP TRIGGER IF EXISTS atom_registration_legal_claim_immutable ON public.atom_registration_legal_claim_snapshots;
CREATE TRIGGER atom_registration_legal_claim_immutable
BEFORE UPDATE OR DELETE ON public.atom_registration_legal_claim_snapshots
FOR EACH ROW EXECUTE FUNCTION public.atom_reject_registration_legal_claim_mutation_v1();
REVOKE ALL ON FUNCTION public.atom_reject_registration_legal_claim_mutation_v1() FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.atom_registration_legal_claim_snapshots IS
 'Unverified selections captured at public request submission, NOT binding Member legal acceptances.';
