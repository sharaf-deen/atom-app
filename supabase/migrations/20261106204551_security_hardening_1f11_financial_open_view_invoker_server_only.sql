-- Security Hardening 1F.11: privileged financial view usable only by trusted server role.
-- Applied to Supabase Staging as migration 20261106204551.
REVOKE ALL PRIVILEGES ON TABLE public.admin_income_events_open_v1 FROM PUBLIC, anon, authenticated;
ALTER VIEW public.admin_income_events_open_v1 SET (security_invoker = true);
