# Functional 1D.1B.2F.1 — Integration & Security Audit

Source: `atom_functional_1d1b2f_staging_source.zip` (1303 archive entries). Review is static; production behavior and integration tests are **not** certified.

## Verified findings

1. `/register` is a **preview only** (`ATOM_PUBLIC_REGISTRATION_PREVIEW`), and its form uses `onSubmit={e => e.preventDefault()}` with a disabled submission button. There is no public registration request creation route in the source archive. **Launch blocker**.
2. No unified Reception-facing queue for `atom_public_registration_requests` existed. Reception `/reception` links to `/kiosk` for legacy Member creation; Family Operations lives at `/admin/members/family-operations`. New `/reception/registrations` page is a **read-only preview** and does not change those flows.
3. Identity check route is admin/head_coach/super_admin, excluding reception; sensitive Auth creation, reconciliation, family provisioning, invitation and resend routes are Super Admin-only. Do not broaden these permissions through the desk.
4. Registration flow uses independent feature flags (Auth provisioning, reconciliation, Member/Family, invitation dispatch/resend, activation). Keep all off in production pending isolated E2E validation.
5. `password_setup_reported_at` is advisory; `/api/public-registration/activation/complete` verifies the session, provenance and SQL RPC after updating password. There remains an ambiguous failure window between Auth update and SQL confirmation requiring manual reconciliation.
6. Registration requests store `claimed_document_version_ids`; do **not** equate this array with official legal acceptance or membership authorization. Legal consent remains an explicit release gate.
7. Current family operations/intake and public registration are distinct workflows. Avoid duplicate writes or automatic conversion of existing family identities.
8. This read-only view shows a limited participant name, age classification, date and derived status to staff permitted on Reception Desk; it deliberately excludes email, phone, Auth IDs and claim IDs. It does not offer sensitive actions.

## Launch blockers / proposed continuation

- **2F.2**: Reception workflow design with explicit adult/parent-child differentiation, safe registration request creation, role-aware staff actions, and a unified queue. Ensure source-of-truth consent confirmation is user/guardian performed; never let reception accept on behalf of a person.
- **2F.3**: Isolated E2E cases: adult, parent+child, existing Auth, existing guardian, duplicate attempts, first-time invite, resend, expired token, repeated activation, failure between Auth and DB; test actual RLS and mail provider outcomes.
- **2F.4**: anti-abuse and rate limiting for public submission; legal version and guardian consent; linked migrations; redirection, logging, email deliverability; explicit deployment/launch checklist and go/no-go signoff.

## This patch

- `src/app/reception/registrations/page.tsx`: protected server-rendered read-only preview of latest 30 requests, status derived from existing persisted fields, and links to existing sanctioned onboarding pages.
- `src/app/reception/page.tsx`: replace the “Create member” quick-action with “Registrations” linking to the preview; the original `/kiosk` remains accessible from the new page.
- No SQL or API changes. No automatic onboarding, Auth, email, consent or payment writes.

## Validation still required

`git diff --check`, `npx tsc --noEmit`, `npm run build`, CI, reception access checks, unauthorized access checks, and review of real UI on mobile. Not tested here against live Supabase.
