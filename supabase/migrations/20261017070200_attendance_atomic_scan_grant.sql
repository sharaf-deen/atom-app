-- Functional 1C.4B: permit service-role server-side scan execution.
GRANT EXECUTE ON FUNCTION public.atom_atomic_member_scan(uuid, uuid, text) TO service_role;
