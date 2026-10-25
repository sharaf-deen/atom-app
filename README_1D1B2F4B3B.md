# Functional 1D.1B.2F.4B.3B — Safe Provisioning Transitions

## Scope
A single Super Admin-only, feature-gated endpoint authorizes **only** two existing, safe manual mutations:
- `RECONCILE_AUTH`: require explicit reason; use the existing provenance-matching Auth recovery + audited PostgreSQL RPC.
- `COMPLETE_MEMBER_FAMILY`: use the existing transactional Member/Family RPC and its DB-side claim, identity and uniqueness checks.

Route: `POST /api/admin/public-registration/provisioning/transition`
JSON: `{ "request_id": "<uuid>", "action": "RECONCILE_AUTH", "confirm": true, "reason": "Explicit investigation reason" }`
Or: `{ "request_id": "<uuid>", "action": "COMPLETE_MEMBER_FAMILY", "confirm": true }`

## Safety
- `ATOM_REGISTRATION_SAFE_TRANSITIONS_ENABLED` MUST remain unset in production until isolated testing.
- Requires authenticated Super Admin; no newly delegated Reception rights.
- Fresh plan read before action; stale/conflicting requests rejected.
- Underlying existing SQL RPC rechecks the authoritative state at mutation time.
- No Auth creation, no invitation dispatch, no legal consent or payment mutation.
- Ambiguous external errors fail closed and require manual investigation.
- An action *result* means the underlying operation returned successfully; it does not constitute an end-to-end validation.

## Isolated test matrix
1. Flag unset => 404; unauthenticated => 401 when enabled; Reception => 403.
2. Request malformed, action invalid, no confirmation => 400.
3. `RECONCILE_AUTH` when plan disagrees => 409, no mutation.
4. `RECONCILE_AUTH` with exact provenance Auth identity, explicit reason => audited record, unchanged Auth count.
5. Missing or ambiguous Auth provenance => blocked, unchanged Auth count.
6. `COMPLETE_MEMBER_FAMILY` only when plan is eligible; subsequent duplicate call blocked or safely idempotent in underlying RPC.
7. Concurrent Member/Family calls do not create duplicate records; verify database counts.
8. No email sends, invitations or subscriptions from the endpoint.

## Launch gate
Do not activate `/register` or any provisioning feature flags in production before complete E2E tests and a recorded GO decision.
