-- Remove PUBLIC's default EXECUTE grant before any client can invoke the RPC.
REVOKE ALL ON FUNCTION public.delete_subscription_with_audit_atomic(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
