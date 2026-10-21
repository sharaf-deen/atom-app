-- A single atomic claim is required before any non-transactional Auth provisioning.
-- Reclaim after 15 minutes is intentionally NOT automatic: an abandoned worker
-- might already have created an Auth account. Manual reconciliation is required.
CREATE OR REPLACE FUNCTION public.atom_claim_registration_provisioning_v1(
  p_request_id uuid,
  p_claim_id uuid
)
RETURNS TABLE (claimed boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_claim_id IS NULL THEN
    RETURN QUERY SELECT false, 'INVALID_IDENTIFIERS'::text;
    RETURN;
  END IF;

  -- A claim must be atomic and only succeed for a verified, non-expired request.
  UPDATE public.atom_public_registration_requests r
  SET status = 'provisioning',
      provisioning_claim_id = p_claim_id,
      provisioning_claimed_at = clock_timestamp(),
      updated_at = clock_timestamp(),
      last_error_code = NULL
  WHERE r.id = p_request_id
    AND r.status = 'under_review'
    AND r.expires_at > clock_timestamp()
    AND r.identity_verified_at IS NOT NULL
    AND r.verified_account_email IS NOT NULL
    AND lower(btrim(r.verified_account_email)) = lower(btrim(r.account_email))
    AND r.member_user_id IS NULL
    AND r.family_id IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 1 THEN
    RETURN QUERY SELECT true, 'CLAIMED'::text;
  ELSE
    RETURN QUERY SELECT false, 'NOT_READY_OR_ALREADY_CLAIMED'::text;
  END IF;
END;
$$;
