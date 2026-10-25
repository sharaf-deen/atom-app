# ATOM — Functional 1D.1B.2F.4C.1 — Acceptance Matrix

**Initial verdict: NO-GO / E2E not yet executed.** This document describes planned tests, not passing tests. Store evidence by isolated test run ID. **Do not run mutation tests on production.**

| ID | Scenario | Expected evidence | Status |
|---|---|---|---|
| A01 | New adult public request | Request created only with test flag on; no Member/Auth yet | NOT RUN |
| A02 | Adult verifies email | Token consumed once; email ownership marked | NOT RUN |
| A03 | Adult Auth provisioning | One account with exact provenance; persisted checkpoint | NOT RUN |
| A04 | Adult Member provisioning | Exactly one matching Member linked to Auth | NOT RUN |
| A05 | Adult invitation + password setup | Email provider trace, activated_at, status completed | NOT RUN |
| A06 | Adult legal acceptance | Current versions accepted by signed-in adult and compliance checked | NOT RUN |
| A07 | Adult profile access | Member sees own profile and not others | NOT RUN |
| F01 | Parent registers child | Registration request belongs to guardian email | NOT RUN |
| F02 | Parent verifies email | Verified parent email tied to registration request | NOT RUN |
| F03 | Parent Auth/Family/Child | Single parent Auth, Family, child Member, guardian link; no child Auth | NOT RUN |
| F04 | Parent invitation + activation | Parent completes password; activation persisted | NOT RUN |
| F05 | Child legal consent | Appropriate verified guardian explicitly accepts current versions | NOT RUN |
| F06 | Family data isolation | Other user cannot read/modify child's record | NOT RUN |
| S01 | Existing Auth email | No duplicate created; needs review | NOT RUN |
| S02 | Duplicate simultaneous submit | One logical request; generic responses | NOT RUN |
| S03 | IP/email rate limiting | Limits enforced against isolated proxy configuration | NOT RUN |
| S04 | Malformed/oversized payload | Rejected; no partial records | NOT RUN |
| S05 | Wrong role on privileged API | Reception/member/anon denied | NOT RUN |
| R01 | Auth call success, checkpoint failure | Blocked; exact-provenance reconciliation only | NOT RUN |
| R02 | Member/Family SQL failure | Atomic rollback; no orphan children | NOT RUN |
| R03 | Email dispatch ambiguous | No automatic resend; audit trace | NOT RUN |
| R04 | Password update success, finalization failure | Blocked and recoverable with no fake completed status | NOT RUN |
| L01 | Stale legal document version | No final acceptance of obsolete version | NOT RUN |
| L02 | Unverified legal claim | Cannot be silently promoted to Member legal acceptance | NOT RUN |
| U01 | Reception mobile UX | Adult/family navigation and status readable | NOT RUN |
| U02 | Super Admin panel | Only Super Admin sees and can invoke privileged actions | NOT RUN |

## Test execution prerequisites

1. Separate Supabase test project and preview deployment, confirmed **not production**.
2. Test identities and email inboxes under administrator control; no real Member or family data.
3. Complete authorized test flags, correctly configured callback origins and trusted proxy/IP anti-abuse measures **only in the isolated environment**.
4. Snapshot test DB before mutation tests; plan account and email cleanup after tests.
5. Record for each case: date, build SHA, test project identifier (not secrets), tester, PASS/FAIL/BLOCKED, sanitized DB query/API response/screenshot and issue link.
6. Verify existing consent UI exists and actually binds to authenticated flow; do not infer this from API presence alone.
7. Never mark a test PASS from a static file check, TypeScript success, or CI build alone.

## Decision

- **GO** only if A01–A07, F01–F06, S01–S05, R01–R04, L01–L02 and U01–U02 are executed and pass, with required infrastructure safeguards and approved rollout.
- **NO-GO** if any critical scenario fails, remains blocked, or has no evidence.
