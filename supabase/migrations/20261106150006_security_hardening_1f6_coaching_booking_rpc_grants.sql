-- Applied on Staging 20261106150006.
REVOKE EXECUTE ON FUNCTION public.private_coaching_cancel_booking_by_coach(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.private_coaching_cancel_session_request(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.private_coaching_complete_booking_by_coach(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.private_coaching_confirm_session_request(uuid,uuid) FROM PUBLIC, anon, authenticated;
