-- Functional 1C.4B: restrict atomic member scan execution.
REVOKE ALL ON FUNCTION public.atom_atomic_member_scan(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
