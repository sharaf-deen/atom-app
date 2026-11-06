-- Security Hardening 1F: direct table writes require Super Admin; read policies unchanged.
ALTER POLICY expenses_insert_ops ON public.expenses WITH CHECK (public.is_super_admin((select auth.uid())));
