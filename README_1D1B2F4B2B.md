# Functional 1D.1B.2F.4B.2B — Authenticated Legal Consent Finalization: Server Foundation

- Adds GET/POST `/api/public-registration/legal-consent/finalize`.
- Requires authenticated Supabase Auth user with matching trusted app metadata, a completed and activated public registration, and exact Member / Family binding.
- Requires explicit acceptance of all currently active required legal document versions; calls the existing `record_member_legal_acceptances_v1` through `recordMemberLegalAcceptances`.
- Reads compliance after write; the existing RPC handles duplicate `(member_user_id, document_version_id)` entries idempotently.
- For children: guardian account and family membership must both match. This checks stored link and claimed relationship, NOT independently verified legal guardianship; a separate human-reviewed authority check and UX must precede live minor use.
- Deliberately disabled by default via `ATOM_REGISTRATION_LEGAL_FINALIZATION_ENABLED`.
- No new schema migration; no new public-registration opening, no subscription changes, no conversion of unverified legal snapshots.
- No standalone UX yet: the authenticated consent capture and parent authority review must be developed and tested before enabling.
- Security regression tests needed: invalid claims, wrong account/email, wrong family/child, multiple versions, missing documents, absent DOB, repeat submissions, cross-origin requests, concurrent updates, and old signup workflows.
