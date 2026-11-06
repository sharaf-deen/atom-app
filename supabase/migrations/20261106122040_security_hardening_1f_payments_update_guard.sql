-- Security Hardening 1F: direct table writes require Super Admin; read policies unchanged.
ALTER POLICY payments_update_ops ON public.payments USING (public.is_super_admin((select auth.uid()))) WITH CHECK (public.is_super_admin((select auth.uid())));
