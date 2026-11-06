-- Security Hardening 1F: direct table writes require Super Admin; read policies unchanged.
ALTER POLICY expenses_delete_admin ON public.expenses USING (public.is_super_admin((select auth.uid())));
