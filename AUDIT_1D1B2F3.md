# ATOM App — Functional 1D.1B.2F.3: End-to-End Integration Audit (phase 1)

Scope: supplied staging source snapshot. This report is a **source-code audit**, not an executed end-to-end test.

## Confirmed source findings

1. `/register` is still a preview. `PublicRegistrationForm.tsx` prevents submit and the submit button is disabled. There is no public request-creation endpoint in the snapshot. **Launch blocker.**
2. The email verification route validates and consumes single-use tokens; it does not create an account or guarantee legal consent.
3. Auth creation, member/family provisioning, invitation, and resend routes are separate, feature-flagged operations. The production flags should remain off until integration tests are complete.
4. Activation `/api/public-registration/activation/complete` performs authenticated password update and then calls the finalization RPC. If the RPC fails after password update, staff intervention is required. **Recovery test outstanding.**
5. The registration request tracks legal document *selections* but these are not durable member legal-acceptance records. **Separate legal-consent gating is required before paid access.**
6. Existing `Registration Desk` only displayed high-level statuses. It lacked visible guidance for Auth checkpoint gaps and ambiguous invitation dispatch. The attached patch adds a read-only lifecycle classifier and reception-friendly next actions.
7. Existing adult and family intake navigation remains in `/kiosk` and `/admin/members/family-operations`; reception role access to both destinations needs an authenticated test.

## Patch scope

- New pure `registrationDeskDisplay` classifier, **never used for authorization**.
- Expand the server's read-only DB projection (no raw Auth, claim or provider IDs are forwarded to browser).
- Flag incomplete Auth checkpoint, ambiguous email send, inconsistent completion, expired request and unknown status for Super Admin review.
- Show an actionable `Next:` line in the Reception request list; 'Needs review' filter uses the explicit boolean instead of text matching.
- No SQL migration, new API, authentication changes, or provisioning writes.

## Test matrix (isolated environment only)

| Scenario | Expected outcome |
|---|---|
| New adult request | Single Auth identity and Member; no automatic payment or consent |
| Parent and child | One parent Auth, family guardian relation, child Member without child Auth |
| Existing account | Block until verified account ownership resolution |
| Duplicate submission | No duplicate Auth, Member or family |
| Auth create succeeds but checkpoint fails | Reconciliation, not blind retry |
| Email provider times out after dispatch | Needs admin review; no automatic resend |
| Activation password succeeds, DB finalization fails | Not completed; deterministic recovery needed |
| Pending verification expired | Escalation and fresh verification flow |
| Claimed legal docs | Never equated with verified legal acceptance |
| Reception account access | Desk access, sensitive admin routes forbidden |
| Unauthorized actor | Cannot see Registration Desk or execute admin provisioning APIs |
| Member family mismatch | No account activation |

## Launch gate — NOT READY

Do not enable `/register` or registration provisioning / invitation feature flags on production. Public submission, anti-abuse, legal acceptance recording, complete E2E tests, and operational recovery are pending. This patch does not close 2F.3.
