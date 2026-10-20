-- Functional 1C.5B.3D.1: anonymous clients never write consent evidence directly.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.member_legal_acceptances FROM anon;
