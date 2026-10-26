# Functional 1D.1B.2F.4C.2A — Authenticated Legal Consent UX

## Scope
- Adult registration identities only. Post-password activation navigates to `/auth/registration-consent`.
- Existing accounts retain their original `next` behavior.
- GET legal endpoint returns the authenticated adult signer name for prefill; POST still checks it against the authenticated profile.
- Documents are loaded from the current authenticated legal-documents endpoint; every active required version needs an explicit unchecked acceptance.
- Submission uses the existing authenticated legal finalization API and verifies completion with an independent GET before redirecting.
- Minor/guardian requests are deliberately blocked for separate family review.
- No new SQL, no changes to feature flags, no automatic acceptance.

## Security / limitations
- Keep `ATOM_REGISTRATION_LEGAL_FINALIZATION_ENABLED=false` in production pending isolated testing. When disabled, the page displays an unavailable message instead of bypassing consent.
- This is the post-invitation UX, **not a global authorization gate**. Existing dashboard routes may still be navigable before consent; enforcing universal gating is a separate security/UX change.
- Guardian authority assurance remains outside scope. Do not use this page for child consent.
- Existing server-side origin checking and registered-request checks remain unchanged.
- Do not mark Adult E2E PASS until real isolated tests establish success.

## Verification
`git diff --check` then `npx tsc --noEmit` then `npm run build` before commit.

Isolated tests: feature flag OFF -> blocked; flag ON + adult session -> documents; missing checkbox -> disabled; wrong signer -> 409; successful acceptance -> server GET complete -> /profile; unrelated password reset unchanged; parent registration -> blocked.
