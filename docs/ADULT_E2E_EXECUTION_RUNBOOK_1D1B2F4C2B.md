# 2F.4C.2B — Isolated Adult E2E Execution Runbook

**Status: NOT RUN. Production: NO-GO.** The supplied source archive alone cannot validate Vercel Preview, Supabase settings, actual email delivery, or the real Auth flow.

## 1. Hard isolation gate — stop on any mismatch

1. In Vercel confirm the Preview deployment SHA, hostname and that its **Supabase URL, anon key and service role key point to an entirely separate test project**. Inspect the project ref shown in the Supabase URL; do not paste the keys into chat or manifests.
2. Confirm separately the production Supabase project ref is different. The script compares only the non-secret refs and URLs; **it does not inspect Vercel or Supabase**.
3. Confirm all migrations, required RPCs, test documents, test Super Admin and Reception roles exist in the test project. Do not clone real Member/Family/finance data.
4. Configure test-only domain, email provider/sandbox and callback URLs, controlled inbox. Verify invitations cannot go to members. Take a backup and document teardown.
5. In production, leave registration/provisioning/invitation/activation/legal finalization feature flags OFF. Only Preview can enable required flags once isolated: `ATOM_PUBLIC_REGISTRATION_PREVIEW`, `ATOM_PUBLIC_REGISTRATION_SUBMIT_ENABLED`, `ATOM_REGISTRATION_AUTH_PROVISIONING_ENABLED`, `ATOM_REGISTRATION_MEMBER_FAMILY_PROVISIONING_ENABLED`, `ATOM_REGISTRATION_INVITATION_ENABLED`, `ATOM_REGISTRATION_DEFINITIVE_ACTIVATION_ENABLED`, `ATOM_REGISTRATION_LEGAL_FINALIZATION_ENABLED`. Other recovery flags should remain OFF except for individually supervised recovery tests.
6. Copy `docs/ADULT_E2E_EXECUTION_MANIFEST_TEMPLATE.json` **outside the repository** and fill it out; avoid names, tokens, passwords or keys. TRUE flags are self-attestations, not programmatically verified.
7. Run `node scripts/check-adult-e2e-execution.cjs --manifest C:\path\to\test-manifest.json`. Any exit code 2 = STOP. Exit code 0 does not prove isolation: a human must confirm console settings.

## 2. Run happy path in Preview only

Execute one fictitious adult with a unique email address; record timestamp, deployment SHA, anonymized request reference and screenshot/SQL references in the private evidence location.

| ID | Controlled manual action | PASS evidence required |
|---|---|---|
| A01 | Submit `/register` | Generic response; exactly one registration request in test DB; no premature Auth/Member |
| A02 | Have test staff send verification; open test inbox; attempt replay | Verified once; replay rejected |
| A03 | Super Admin preflight and identity check | Correct unique account, no unexpected conflicts |
| A04 | Super Admin runs guarded provisioning stages | Exactly one Auth and one matching Member; no Family child |
| A05 | Send invitation to test inbox | Test email received, link and intended callback valid; no duplicate |
| A06 | Set password via invitation | Activated checkpoint and status consistent; no second Auth |
| A07 | Complete authenticated legal page | Current required documents read and accepted individually; recorded server-side, no pre-checks |
| A08 | Log out/login, access own Member, attempt other test Member | Own profile accessible; cross-member access denied; direct route access and legal gate separately assessed |

## 3. Failure and recovery scenarios — separate test records

| ID | Scenario | PASS evidence required |
|---|---|---|
| A09 | Repeated public submission | No duplicate identity/request; generic non-disclosing response |
| A10 | Expired/invalid invite | Rejected; only explicit controlled resending/reconciliation |
| A11 | Interrupted Auth creation (test-only fault simulation) | Provenance checked and manual recovery without new Auth account |
| A12 | Member/Reception calls privileged transition API | 403/appropriate rejection; no mutation |

Do not manufacture real interrupted states by partially altering production or directly editing Auth metadata. Only simulate faults within a safe isolated test protocol. Keep mutation/recovery flags OFF unless conducting a supervised scenario.

## 4. Evidence and final verdict

- Evidence fields: scenario ID, PASS/FAIL/BLOCKED/NOT_RUN, observedAt, tester, private evidenceRef, actual vs expected, deployment SHA.
- A PASS must have evidenceRef, observedAt, tester; the manifest tool checks fields but **does not validate the contents or perform E2E tests**.
- Test failures or absent evidence => **NO-GO**.
- Even all twelve PASS do not imply launch approval: guardian/family, security regressions, cross-route consent enforcement and deployment review remain outstanding.
- A07 must use the newly added `/auth/registration-consent` page and the authenticated legal finalization API. The old 2F.4C.2 readiness runbook incorrectly describes it as missing; that historical finding was addressed by 2F.4C.2A, subject to actual verification.
