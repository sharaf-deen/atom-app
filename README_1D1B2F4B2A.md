# Functional 1D.1B.2F.4B.2A — Public Legal Claim Evidence Foundation

The migration captures immutable snapshots of the active mandatory document versions selected at public request submission, together with the declared signer's name/capacity. No Member legal acceptance is created; these are explicitly **unverified claims**. This limits silent document-version drift and preserves a source record for subsequent consent confirmation. It does NOT prove the signer was the account owner or a legal guardian.

The public form asks the person submitting to explicitly confirm their role. The server derives identity and role from the existing validated participant/guardian fields. The database trigger revalidates required document versions atomically at insertion, preventing stale or manipulated document sets.

The trigger affects **new inserts only**. Older requests will have no snapshots and must be reviewed or renewed rather than silently upgraded. Snapshots reject updates/deletes. No retroactive consent is manufactured. No automatic Member legal acceptance is recorded.

## Remaining blocker (2F.4B.2B)
After verified Auth sign-in and adult/guardian relationship validation, collect an actual fresh authenticated legal acceptance using the existing legal consent system. Confirm current required versions; create member_legal_acceptances only through its trusted RPC; enforce before actions that require consent. Do not treat this claim snapshot as completed consent. Production public registration remains NO-GO.

## Deploy
Run the SQL migration and verify snapshot RLS/trigger/function grants in isolated staging. Test new adult and guardian requests, stale document IDs, duplicate IDs, and snapshot immutability. No service-role data mutation in production as a test.
