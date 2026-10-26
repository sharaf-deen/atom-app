# Functional 1D.1B.2F.4C.2C — Email Verification 503 Diagnostic Hotfix

## Goal
Pinpoint the failing stage of `POST /api/admin/public-registration/verification/send` without exposing secrets or modifying the successful lifecycle.

## Modified tracked files (3)
- `src/app/api/admin/public-registration/verification/send/route.ts` — allowlisted failure code in server runtime logs; API response remains generic HTTP 503.
- `src/lib/publicRegistrationEmailVerification.ts` — record only PostgreSQL error codes at token issuance / email snapshot writes.
- `src/lib/publicRegistrationVerificationDelivery.ts` — record network-vs-provider failure and HTTP status (no provider response body).

## Procedure
1. Apply patch to a clean branch off current `staging`.
2. Run `git diff --check`, `npx tsc --noEmit`, `npm run build` **before commit**.
3. Deploy from **staging branch to staging environment**; verify the deployment source/target and staging Supabase URL.
4. Check the current verification state of the existing request in `atomjj-staging` (read-only). Only if still eligible and no issued token, trigger one authorized test attempt, then inspect **Vercel Runtime Logs** for `[registration-verification/...`.
5. If no output appears, filter the logs by deployment and invocation time, without sharing credentials, request bodies or verification links.

## Interpretation
- `REGISTRATION_EMAIL_PROVIDER_NOT_CONFIGURED`: `RESEND_API_KEY` or `MAIL_FROM` unavailable at runtime.
- `REGISTRATION_APP_ORIGIN_*`: missing/invalid public app URL.
- `REGISTRATION_VERIFICATION_ISSUE_FAILED` + dbCode: first Supabase update failed. `42703` undefined column; `42501` insufficient privilege; `23514` check constraint; `PGRST...` PostgREST issue.
- `REGISTRATION_VERIFICATION_SNAPSHOT_FAILED` + dbCode: second update failed.
- `REGISTRATION_VERIFICATION_DELIVERY_FAILED` + phase/network or httpStatus: Resend failure after token issuance; don't retry without checking database state/cooldown.
- `REGISTRATION_VERIFICATION_UNEXPECTED_FAILURE`: check deployment secret/client initialization.

## Safety
No schema migration, no new flag, no Auth/Member creation, no automatic email, no raw email/token/key/provider body logging. Production registration flags remain OFF. The hotfix **does not resolve an unknown database/provider error by itself**; it makes a precise repair possible.
