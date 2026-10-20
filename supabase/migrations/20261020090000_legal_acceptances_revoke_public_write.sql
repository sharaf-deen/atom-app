-- Functional 1C.5B.3D.1: remove write privileges inherited through PUBLIC.
-- Read access and RLS policies are unchanged.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.member_legal_acceptances FROM PUBLIC;
