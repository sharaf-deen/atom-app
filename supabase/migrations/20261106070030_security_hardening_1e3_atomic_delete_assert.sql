-- Require no client role access after privilege hardening.
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
