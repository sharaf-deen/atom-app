-- Staging migration 20261106151433: remove direct client EXECUTE on internal helpers and materialized-view refresh.
REVOKE EXECUTE ON FUNCTION public.apply_mapped_training_program_to_session_internal(uuid,uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.apply_schedule_series_coaching_team_to_session_internal(uuid,text,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.apply_training_program_team_to_session(uuid,uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_schedule_series_coaching_team_internal(text,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_training_program_schedule_internal(uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.unlink_training_program_from_session_internal(uuid,uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.refresh_members_with_activity_mv() FROM PUBLIC, anon, authenticated;
