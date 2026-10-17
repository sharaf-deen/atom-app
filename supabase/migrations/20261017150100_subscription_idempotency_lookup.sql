-- Replay lookup is service-role only; verifies original actor, member, operation, and body fingerprint.
CREATE OR REPLACE FUNCTION public.atom_subscription_idempotency_lookup(
  p_request_key uuid, p_operation text, p_member_id uuid, p_actor_id uuid, p_request_hash text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE v public.atom_subscription_idempotency%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.atom_subscription_idempotency WHERE request_key = p_request_key;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v.operation IS DISTINCT FROM p_operation OR v.member_id IS DISTINCT FROM p_member_id
    OR v.actor_id IS DISTINCT FROM p_actor_id OR v.request_hash IS DISTINCT FROM p_request_hash THEN
    RAISE EXCEPTION 'SUBSCRIPTION_IDEMPOTENCY_CONFLICT' USING ERRCODE = '23505';
  END IF;
  RETURN v.subscription_id;
END;
$$;
