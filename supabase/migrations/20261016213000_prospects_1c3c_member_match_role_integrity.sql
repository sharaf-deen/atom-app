-- Functional 1C.3C: prevent role-filter bypass on Prospect -> existing Member matching.
-- The OR branches must both remain subordinate to the eligible role filter.
-- No historical data modification.
BEGIN;

CREATE OR REPLACE FUNCTION public.prospect_link_existing_member(
  p_prospect_id uuid,
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_prospect public.prospects%rowtype;
  v_matches uuid[];
  v_result jsonb;
BEGIN
  SELECT * INTO v_prospect
  FROM public.prospects
  WHERE id = p_prospect_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROSPECT_NOT_FOUND'; END IF;

  IF v_prospect.linked_member_id IS NOT NULL THEN
    RETURN public.prospect_link_member(p_prospect_id, v_prospect.linked_member_id, p_actor_user_id);
  END IF;

  SELECT array_agg(x.user_id ORDER BY x.created_at ASC)
  INTO v_matches
  FROM (
    SELECT DISTINCT p.user_id, p.created_at
    FROM public.profiles p
    WHERE p.role IN ('member','champion','vip','assistant_coach','coach','head_coach')
      AND (
        (
          v_prospect.email_normalized IS NOT NULL
          AND public.prospect_normalize_email(p.email) = v_prospect.email_normalized
        )
        OR
        (
          v_prospect.phone_digits IS NOT NULL
          AND public.prospect_normalize_phone(p.phone) = v_prospect.phone_digits
          AND public.prospect_normalize_name(concat_ws(' ', p.first_name, p.last_name)) = public.prospect_normalize_name(v_prospect.full_name)
        )
      )
  ) x;

  IF coalesce(cardinality(v_matches), 0) > 1 THEN
    RAISE EXCEPTION 'PROSPECT_MEMBER_CONTACT_CONFLICT';
  END IF;

  IF coalesce(cardinality(v_matches), 0) = 0 THEN
    RETURN jsonb_build_object('matched', false, 'member_user_id', NULL);
  END IF;

  v_result := public.prospect_link_member(p_prospect_id, v_matches[1], p_actor_user_id);
  RETURN jsonb_build_object('matched', true) || v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.prospect_link_existing_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prospect_link_existing_member(uuid, uuid) TO service_role;

COMMIT;
