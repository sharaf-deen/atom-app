-- Security Hardening 1F: direct table writes require Super Admin; read policies unchanged.
ALTER POLICY expenses_update_ops ON public.expenses USING (public.is_super_admin((select auth.uid()))) WITH CHECK (public.is_super_admin((select auth.uid())));
