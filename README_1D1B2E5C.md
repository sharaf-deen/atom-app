# Functional 1D.1B.2E.5C — Delivery Inspection & Controlled Resend

## Scope
- Super Admin-only provider lookup via Resend GET `/emails/{id}`; provider state is observational, not a receipt from the user.
- Persistent, reasoned resend audit with row-locked atomic reservation, 15-minute cooldown and maximum 3 resends.
- Initial dispatch must already be recorded. Uncertain original sends and uncertain resend attempts remain blocked from further attempts.
- Server-side Auth provenance, family guardianship and sign-in checks in the SQL reservation RPC.
- Retain immutable initial invitation fields; no Auth/Member/Family/consent/payment changes.
- All operations disabled by default; `/register` remains disabled.

## Feature flags (leave unset in production)
- `ATOM_REGISTRATION_INVITATION_RECONCILIATION_ENABLED`
- `ATOM_REGISTRATION_INVITATION_RESEND_ENABLED`

## Endpoints
- `POST /api/admin/public-registration/invitation/reconcile` with `{ "request_id": "uuid" }`: inspect latest recorded provider email without writing.
- `POST /api/admin/public-registration/invitation/resend` with `{ "request_id": "uuid", "claim_id": "uuid", "reason": "at least 12 chars" }`: explicitly reserve and send one new link.

## Important constraints
- Reconciliation does **not** resolve an uncertain send by guessing whether it arrived. Such attempts remain blocked pending a separate manual recovery policy.
- A recorded provider result such as `sent` does not prove email receipt, and `delivered` does not prove account activation.
- Email link generation and email sending are external nontransactional calls. Persist reservation before either call; after a network failure, do not auto-retry.
- A resend can generate a new Supabase recovery link; it may invalidate the previous link. Test on isolated Auth accounts.
- Do not activate flags or use on production accounts before isolated end-to-end verification.
