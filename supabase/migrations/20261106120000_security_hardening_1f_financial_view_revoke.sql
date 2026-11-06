-- Security Hardening 1F: the finance aggregation view is server-only.
-- The view is SECURITY DEFINER and exposes member/payment metadata.
-- The underlying admin_income_events_v1 view was already locked down in 1A.
-- Keep service_role privileges unchanged; deny direct client reads.
REVOKE SELECT ON TABLE public.admin_income_events_open_v1 FROM anon, authenticated;
