-- Functional 1C.5A.1: RPC is never directly available to clients.
REVOKE ALL ON FUNCTION public.atom_create_subscription_with_initial_payment(jsonb, uuid) FROM PUBLIC, anon, authenticated;
