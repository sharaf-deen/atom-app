-- Security Hardening 1F.10: prevent anonymous access to financial income-event view.
-- Applied on Supabase Staging 20261106203019.
-- Signed-in access is preserved temporarily pending caller and RLS review.
REVOKE ALL PRIVILEGES ON TABLE public.admin_income_events_open_v1 FROM PUBLIC, anon;
