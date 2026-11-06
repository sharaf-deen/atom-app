-- Security Hardening 1F.1–1F.3 — Staging audited financial table grants and write RLS
-- Applied to Supabase Staging via migration 20261106133214.
-- Leaves all SELECT policies unchanged and does not modify subscription_payments.
-- Do not deploy to Production without separate approval and role-based smoke tests.

REVOKE TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.expenses, public.payments
FROM anon, authenticated;

ALTER POLICY expenses_insert_ops ON public.expenses
  WITH CHECK (public.is_super_admin(auth.uid()));

ALTER POLICY expenses_update_ops ON public.expenses
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

ALTER POLICY expenses_delete_admin ON public.expenses
  USING (public.is_super_admin(auth.uid()));

ALTER POLICY payments_insert_ops ON public.payments
  WITH CHECK (public.is_super_admin(auth.uid()));

ALTER POLICY payments_update_ops ON public.payments
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

ALTER POLICY payments_delete_admin ON public.payments
  USING (public.is_super_admin(auth.uid()));
