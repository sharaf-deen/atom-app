-- The privileged server-side Supabase client is the sole allowed caller.
GRANT EXECUTE ON FUNCTION public.delete_subscription_with_audit_atomic(uuid, uuid)
  TO service_role;
