-- Security Hardening 1F.8: server-only legacy member search, membership stats and store dashboard RPCs.
-- Already applied on Supabase Staging as migration 20261106155207.
REVOKE EXECUTE ON FUNCTION public.admin_store_dashboard_summary(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.members_activity_stats_v3() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.search_members_v3(text,text,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.search_members_v3_core(text,text,integer,integer) FROM PUBLIC, anon, authenticated;
