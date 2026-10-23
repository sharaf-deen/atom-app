# Functional 1D.1B.2E.5D — Definitive Account Activation

This is a guarded technical activation foundation, not authorization for public release.

- Registration identities send password setup through authenticated server route.
- The route updates the password with the user's Supabase session, **not** service-role Auth admin.
- After success, a service-role-only RPC validates request/claim provenance and Member/Family links inside a transaction and records `account_activated_at` plus `completed` status.
- If Auth succeeds but database finalization fails, the account is flagged for review; never presume activation.
- Non-registration password setup retains legacy behavior.
- Existing advisory `password_setup_reported_at` is not used as proof of activation.
- No legal consent, membership/subscription/payment mutations, automatic invitation resend, or public registration enablement.
- Feature flag `ATOM_REGISTRATION_DEFINITIVE_ACTIVATION_ENABLED` must remain OFF in production until isolated tests and operational remediation are implemented.
- SQL migration `20261023120000_registration_definitive_activation.sql` must be applied and migration history synchronized.
- Test an adult and a parent-managed minor in isolated environment; test replay, absent invitation, provenance mismatch, DB failure after Auth mutation, and unrelated password flows.
- Known limitation: if Auth password mutation succeeds and SQL finalization fails, safe recovery requires manual review; no automatic retry of the activation RPC is exposed.
