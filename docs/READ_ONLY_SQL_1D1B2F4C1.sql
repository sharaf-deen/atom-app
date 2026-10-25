-- READ ONLY. Run against the intended project only. No direct personal identifiers exposed.
-- Check migration versions and request distribution without accessing tokens, names, emails or IP fingerprints.
SELECT status, is_minor, COUNT(*) AS requests
FROM public.atom_public_registration_requests
GROUP BY status, is_minor
ORDER BY status, is_minor;

SELECT
 COUNT(*) FILTER (WHERE identity_verified_at IS NOT NULL) AS email_verified,
 COUNT(*) FILTER (WHERE provisioning_claim_id IS NOT NULL) AS provisioning_claimed,
 COUNT(*) FILTER (WHERE provisioned_auth_user_id IS NOT NULL) AS auth_recorded,
 COUNT(*) FILTER (WHERE member_user_id IS NOT NULL) AS member_recorded,
 COUNT(*) FILTER (WHERE invitation_dispatched_at IS NOT NULL) AS invitation_recorded,
 COUNT(*) FILTER (WHERE account_activated_at IS NOT NULL) AS account_activated,
 COUNT(*) FILTER (WHERE account_activated_at IS NOT NULL AND status <> 'completed') AS activation_status_conflicts,
 COUNT(*) FILTER (WHERE is_minor AND member_user_id IS NOT NULL AND family_id IS NULL) AS minor_family_conflicts,
 COUNT(*) FILTER (WHERE invitation_dispatched_at IS NOT NULL AND provisioned_auth_user_id IS NULL) AS invitation_auth_conflicts
FROM public.atom_public_registration_requests;

SELECT version, name
FROM supabase_migrations.schema_migrations
WHERE version IN ('20261023190000', '20261024100000', '20261023120000', '20261023103000')
ORDER BY version;
