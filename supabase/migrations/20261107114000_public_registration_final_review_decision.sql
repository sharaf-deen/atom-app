-- Public Registration Final Integration: durable Super Admin rejection rationale.
-- No public table grants added. RLS on registration requests remains deny by default.
ALTER TABLE public.atom_public_registration_requests
  ADD COLUMN IF NOT EXISTS review_decision_by uuid,
  ADD COLUMN IF NOT EXISTS review_decision_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_reason text;

COMMENT ON COLUMN public.atom_public_registration_requests.review_reason
  IS 'Restricted internal reason for Super Admin rejection; never expose to public endpoints.';
