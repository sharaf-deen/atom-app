# Functional 1D.1B.2F.4B.3A — Fail-Closed Orchestration Decision Plan

## Scope
- Pure read-only classifier of public registration checkpoints.
- Super Admin-only POST `/api/admin/public-registration/provisioning/plan` with `{ "request_id": "uuid" }`.
- No SQL migration, no account or family writes, no invitation email, no new permissions.
- Response contains only a safe next-step code, generic reason, and a review flag.
- No claim ID or personal data returned. All actual mutation endpoints still enforce their own controls.

## Non-goals
- No automatic chaining of Auth creation, Member/Family provisioning, or email dispatch.
- No recovering ambiguous side effects automatically.
- No claim ownership, role delegation to Reception, or legal consent finalization.

## Critical review checks
- Expired or inconsistent requests block progression.
- Auth started but not recorded => reconciliation before retry.
- Invitation started but not recorded => reconciliation before resend.
- Parent/child without required family binding => block.
- `completed` is technical activation only; legal consent remains separate.

## Manual tests (isolated environment)
1. Unauthorized session and Reception user => 401/403.
2. Missing request and malformed UUID => 404/400.
3. Pending verification => WAIT_FOR_VERIFICATION.
4. Under review with valid email => REVIEW_IDENTITY_AND_CLAIM.
5. Auth started but not recorded => RECONCILE_AUTH.
6. Invitation started but not recorded => RECONCILE_INVITATION.
7. Completed with matching checkpoints => CHECK_LEGAL_CONSENT.
8. All malformed or conflicting checkpoints => BLOCKED_REQUIRES_REVIEW.
9. Confirm no writes or emails on all tests.

## Launch
Still NO-GO. Public submission and provisioning feature flags must remain disabled in production.
Follow-up 3B: safe recovery handling. Follow-up 3C: operational UI integration.
