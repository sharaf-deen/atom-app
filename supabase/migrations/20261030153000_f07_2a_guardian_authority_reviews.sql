-- F07.2A: auditable guardian authority review decisions, STAGING rollout first.
-- Append-only history. F07.2B is a separate release and consent remains blocked.
CREATE TABLE IF NOT EXISTS public.atom_guardian_authority_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE RESTRICT,
  guardian_auth_user_id uuid NOT NULL,
  member_user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('verified', 'rejected', 'requires_review')),
  evidence_method text NOT NULL CHECK (evidence_method IN ('in_person_documents', 'verified_official_record', 'other_reviewed_evidence')),
  evidence_reference text NOT NULL CHECK (char_length(btrim(evidence_reference)) BETWEEN 4 AND 160),
  review_note text NOT NULL CHECK (char_length(btrim(review_note)) BETWEEN 12 AND 1000),
  reviewed_by uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE RESTRICT,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT atom_guardian_authority_reviews_distinct_actor CHECK (reviewed_by <> guardian_auth_user_id)
);
CREATE INDEX IF NOT EXISTS atom_gar_latest_idx ON public.atom_guardian_authority_reviews
  (family_id, guardian_auth_user_id, member_user_id, reviewed_at DESC, id DESC);
ALTER TABLE public.atom_guardian_authority_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.atom_guardian_authority_reviews FROM PUBLIC, anon, authenticated;
-- Service role bypasses RLS; no direct browser table access is granted.
-- Immutable history, including for service-role API operations: use explicit functions
-- (a service-role actor can technically bypass normal privileges, so API never updates).
CREATE OR REPLACE FUNCTION public.atom_f07_2a_prevent_review_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'GUARDIAN_REVIEW_IMMUTABLE';
END;
$$;
DROP TRIGGER IF EXISTS atom_f07_2a_immutable_history ON public.atom_guardian_authority_reviews;
CREATE TRIGGER atom_f07_2a_immutable_history
BEFORE UPDATE OR DELETE ON public.atom_guardian_authority_reviews
FOR EACH ROW EXECUTE FUNCTION public.atom_f07_2a_prevent_review_mutation();
