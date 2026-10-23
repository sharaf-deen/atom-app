# Functional 1D.1B.2F.2 — Reception Registration Desk UX

## Scope
- Guided adult vs parent-and-child choice within existing Reception RBAC.
- Reuses existing Kiosk and Family Operations routes without duplicating their creation logic.
- Responsive checklist and accessible search/filter of latest 30 public requests; no provider writes.
- Read-only status display with no Auth IDs, tokens, claim IDs or private emails exposed.

## Limits
- Search and counts apply only to the latest 30 requests, not the entire database.
- No new creation API, no public submission, no automatic invitations or payments.
- Existing family onboarding routes retain their own RBAC; Reception staff may be restricted there independently.
- Test reception access and flow before declaring usability complete.
- Account provisioning flags and /register must remain disabled.
