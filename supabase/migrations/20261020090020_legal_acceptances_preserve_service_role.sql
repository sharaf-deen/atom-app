-- Functional 1C.5B.3D.1: preserve trusted RPC service-role recording path.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.member_legal_acceptances TO service_role;
