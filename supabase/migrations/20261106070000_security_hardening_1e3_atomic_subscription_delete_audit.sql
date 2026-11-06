-- Security Hardening 1E.3 — atomic deletion and audit for subscriptions.
-- Deploy to Staging first. Does not delete data during migration.
-- The existing BEFORE DELETE history-protection trigger is retained.
BEGIN;

CREATE OR REPLACE FUNCTION public.delete_subscription_with_audit_atomic(
  p_subscription_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $atomic$
DECLARE
  v_role text;
  v_deleted_id uuid;
  v_member_id uuid;
BEGIN
  -- This RPC is only for the privileged API client, not end-user sessions.
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF p_subscription_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT' USING ERRCODE = '22023';
  END IF;

  -- Defense in depth: independently validate the authenticated actor's
  -- authoritative server-side profile role before executing the deletion.
  SELECT role INTO v_role
  FROM public.profiles
  WHERE user_id = p_actor_user_id;

  IF v_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.subscriptions
  WHERE id = p_subscription_id
  RETURNING id, member_id INTO v_deleted_id, v_member_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false);
  END IF;

  -- Failure here raises and rolls back the DELETE in this same statement.
  INSERT INTO public.audit_logs (
    actor_user_id,
    target_user_id,
    action,
    action_details
  ) VALUES (
    p_actor_user_id,
    v_member_id,
    'subscription_deleted',
    jsonb_build_object(
      'subscription_id', v_deleted_id,
      'source', 'api/subscriptions/delete'
    )
  );

  RETURN jsonb_build_object(
    'deleted', true,
    'subscription_id', v_deleted_id,
    'audit_logged', true
  );
END;
$atomic$;

-- PostgreSQL gives new functions EXECUTE to PUBLIC unless explicitly revoked.
REVOKE ALL ON FUNCTION public.delete_subscription_with_audit_atomic(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_subscription_with_audit_atomic(uuid, uuid)
  TO service_role;

-- Fail migration if an exposed client role can invoke the function.
DO $assert_1e3$
BEGIN
  IF has_function_privilege(
       'anon', 'public.delete_subscription_with_audit_atomic(uuid, uuid)', 'EXECUTE'
     ) OR has_function_privilege(
       'authenticated', 'public.delete_subscription_with_audit_atomic(uuid, uuid)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'SECURITY_1E3_PUBLIC_RPC_EXECUTE';
  END IF;
END;
$assert_1e3$;
COMMIT;
