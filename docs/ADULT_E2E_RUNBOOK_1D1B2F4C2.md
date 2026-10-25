# ATOM — Adult Registration E2E (2F.4C.2) — execution runbook

## Important finding from provided staging source

**BLOCKED: authenticated legal-consent UX**. `src/app/api/public-registration/legal-consent/finalize/route.ts` exposes GET/POST, but there is no caller of `/api/public-registration/legal-consent/finalize` in the supplied client source. `auth/set-password/page.tsx` does invoke `/api/public-registration/activation/complete`. Do not mark adult legal acceptance / full E2E PASS until an actual authenticated consent UI is wired and verified. An API alone is insufficient.

## Isolation gate (all must be confirmed before any mutation)

- Separate **nonproduction** Supabase project, Vercel Preview and callbacks, not just a different URL pointing to the production database.
- No real member, parent, child, staff, or banking data. Dedicated fictitious test adult email inbox.
- Test Super Admin and Reception identities only in test project; test provider email credentials and safe rate-limit proxy configuration.
- Schema migrations applied on test project; backup before mutations; cleanup plan for Auth, Member, registration and email provider.
- Flag configuration reviewed **only in Preview**: `ATOM_PUBLIC_REGISTRATION_PREVIEW`, `ATOM_PUBLIC_REGISTRATION_SUBMIT_ENABLED`, `ATOM_REGISTRATION_AUTH_PROVISIONING_ENABLED`, `ATOM_REGISTRATION_MEMBER_FAMILY_PROVISIONING_ENABLED`, `ATOM_REGISTRATION_INVITATION_ENABLED`, `ATOM_REGISTRATION_DEFINITIVE_ACTIVATION_ENABLED`, `ATOM_REGISTRATION_LEGAL_FINALIZATION_ENABLED`. Keep production OFF.
- Never store API keys, verification tokens, passwords or full personal data in test evidence.

## Recording evidence

Record project alias, deployed commit SHA, tester, timestamp, anonymized test run ID, scenario, expected and actual observations, PASS/FAIL/BLOCKED, and sanitized database/API/screenshots. Never treat the static scanner as an E2E result.

| ID | Manual execution in isolated Preview | PASS requires |
| --- | --- | --- |
| A01 | Submit a fictitious adult `/register` form | One pending request; no premature Auth/Member creation; generic response |
| A02 | Staff sends verification; open email and verify; attempt replay | Verified once; replay denied |
| A03 | Identity audit then controlled Auth provisioning | No existing account, Auth provenance and single checkpoint correct |
| A04 | Controlled Member provisioning | One Member bound to same Auth, no Family relation, no duplicate |
| A05 | Dispatch invite; follow correct test-origin URL | Delivery recorded and password setup page accessible |
| A06 | Set password in invited authenticated session | Activation RPC completes; `account_activated_at` and `completed` consistent |
| A07 | In authenticated session, accept **current** required legal versions explicitly | GET reflects outstanding obligations, POST records actor/version, compliance complete; BLOCKED until UI connected |
| A08 | Log out/in; verify account profile and deny access to another test Member | Only own records visible; required legal gate honored |

## Failure cases

Use separate test records for preexisting email collision, duplicate submit, expired verification, invalid invitation, and interrupted activation. Do not rerun a potentially successful Auth or email action blindly. Use Super Admin diagnostic/reconciliation and note provenance.

## Read-only evidence SQL

Run the SQL in `docs/ADULT_E2E_READ_ONLY_1D1B2F4C2.sql` **only against the isolated project**. Record counts/checkpoint status rather than identifiers or emails. Queries are aggregated and cannot prove Auth/email delivery or legal acceptance on their own.

## Decision

All A01–A08 require independently collected real E2E evidence to mark 2F.4C.2 PASS. Current stage is **BLOCKED / NO-GO** until isolated execution and legal UI integration.
