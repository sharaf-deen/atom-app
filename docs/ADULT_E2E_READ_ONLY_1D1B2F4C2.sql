-- READ ONLY; use ONLY the isolated non-production Supabase project.
-- Aggregates; no account email, token, password or identifying details.
SELECT status, COUNT(*) AS adult_requests,
       COUNT(*) FILTER (WHERE identity_verified_at IS NOT NULL) AS identity_verified,
       COUNT(*) FILTER (WHERE provisioned_auth_user_id IS NOT NULL) AS auth_recorded,
       COUNT(*) FILTER (WHERE member_user_id IS NOT NULL) AS member_recorded,
       COUNT(*) FILTER (WHERE invitation_dispatched_at IS NOT NULL) AS invitation_dispatched,
       COUNT(*) FILTER (WHERE account_activated_at IS NOT NULL) AS account_activated
FROM public.atom_public_registration_requests
WHERE is_minor = FALSE
GROUP BY status ORDER BY status;

SELECT
 COUNT(*) FILTER (WHERE account_activated_at IS NOT NULL AND status <> 'completed') AS activation_status_conflicts,
 COUNT(*) FILTER (WHERE member_user_id IS NOT NULL AND provisioned_auth_user_id IS NULL) AS member_without_auth,
 COUNT(*) FILTER (WHERE invitation_dispatched_at IS NOT NULL AND member_user_id IS NULL) AS invitation_without_member,
 COUNT(*) FILTER (WHERE is_minor = FALSE AND family_id IS NOT NULL) AS adult_with_family_conflict
FROM public.atom_public_registration_requests;
