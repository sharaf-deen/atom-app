-- Functional 1C.5A.1: server-only invocation after API RBAC + legal checks.
GRANT EXECUTE ON FUNCTION public.atom_create_subscription_with_initial_payment(jsonb, uuid) TO service_role;
