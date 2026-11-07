# ATOM Public Registration — Final Integration

## Scope

Single functional lot on Staging. Reuses existing public request, email verification, identity review, atomic Member/Family provisioning, invitation dispatch, activation and legal-consent mechanisms. **No automatic account activation and no payment/subscription creation.**

## Public journey

1. Staff shares `/registration` (also linked from `/reception/registrations`).
2. Prospect completes the existing form: adult email or parent email for minors, DOB, active program, and all current required legal-document acknowledgements.
3. `POST /api/public-registration/submit` validates input, HMAC IP rate limiting and the existing submit flag; creates only a pending request. Reply is generic to avoid revealing account existence.
4. Authorized staff initiates email verification via existing flow. A verified address is mandatory for approval.
5. Super Admin opens `/reception/registrations` and obtains fresh server diagnosis. They explicitly approve or reject the dossier.
6. Approval uses the existing identity-duplicate audit and atomic claim RPC. Each subsequent step is separately confirmed: Auth creation, Member/Family creation, invitation dispatch. A failed/ambiguous Auth or email operation is reviewed, **not automatically retried**.
7. Prospect completes password setup and legal-consent lifecycle. For minors, the linked parent/guardian remains subject to separate authority review.

**Important:** The public form records claimed document acknowledgements; final legally verified consent is a distinct existing step. No paid membership is activated automatically.

## Environment gates — Staging first

- `ATOM_PUBLIC_REGISTRATION_SUBMIT_ENABLED=true` to accept pending requests.
- `ATOM_REGISTRATION_RATE_LIMIT_SECRET` must exist (at least 32 characters), with appropriate trustworthy ingress IP configuration.
- `ATOM_REGISTRATION_FINAL_INTEGRATION_ENABLED=true` to enable Super Admin review actions.
- Existing fine-grained controls: `ATOM_REGISTRATION_PROVISIONING_CLAIM_ENABLED`, `ATOM_REGISTRATION_AUTH_PROVISIONING_ENABLED`, `ATOM_REGISTRATION_MEMBER_FAMILY_PROVISIONING_ENABLED`, `ATOM_REGISTRATION_INVITATION_ENABLED`, `ATOM_REGISTRATION_SAFE_TRANSITIONS_ENABLED`, `ATOM_REGISTRATION_DEFINITIVE_ACTIVATION_ENABLED`, `ATOM_REGISTRATION_LEGAL_FINALIZATION_ENABLED`.
- On Production, additional `ATOM_REGISTRATION_ACCESS_MODE=pilot` plus `ATOM_REGISTRATION_PILOT_EMAIL_ALLOWLIST` (or explicit `public`) is required for public submission. Do **not** enable Production without acceptance of the Staging end-to-end flows and explicit user approval.
- Email verification and invitation delivery require a configured outbound email provider.

## Authorization and integrity

- New `/api/admin/public-registration/provisioning/advance` verifies same-origin POST, current Supabase session and server-resolved `super_admin` role. It also rechecks the database request state immediately before every action.
- Manual actions: APPROVE, REJECT, CREATE_AUTH, COMPLETE_MEMBER_FAMILY, SEND_INVITATION; existing safe reconciliation endpoint handles interrupted Auth provisioning.
- REJECT is available only before any claim/Auth/member/family/invitation state exists; it uses a conditionally updated row and persists the internal review reason/actor/time.
- Existing database RPCs retain transactional ownership, concurrency protection and duplicate detection.
- UI explicitly confirms each state transition; it does not hold/reveal the claim ID or automatically chain transitions.
- Feature flags remain off unless configured. No real or fictitious registration records created by this PR or migration.

## One consolidated Staging acceptance campaign (not nine repeated module tests)

- **Adult:** new fictitious address; public request -> staff verification -> Super Admin approval -> Auth -> Member -> invite -> password activation -> verified legal consent; confirm no subscription/payment was created.
- **Family:** different new fictitious parent address and child; check guardian review, Family/Member linkage, invite and legal obligations. Reject unrelated family access.
- **Negative:** anon/member/reception/admin cannot call the Super Admin advance endpoint; missing/invalid Origin and feature flags fail closed; reject after approval and double approval are refused; missing email verification, duplicate Auth/profile and invalid legal documents block; no inadvertent retries after ambiguous Auth or email failure.
- Validate existing Finance, Staff Payroll and Family Accounts were not regressed by this integration (changes are isolated to registration and additive review columns).

## Status boundary

The static guardrail test suite, CI and DB Reset + Smoke verify source/build/migrations; they are **not** substitutes for real signed-user/email end-to-end tests. The PR should remain pending functional sign-off until the one complete Staging acceptance campaign passes. Production unchanged and NO-GO pending separate authorization.
