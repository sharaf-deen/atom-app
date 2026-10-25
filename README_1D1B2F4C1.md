# Functional 1D.1B.2F.4C.1 — E2E Test Harness & Acceptance Matrix

This package is **read-only** and **does not contain an automated E2E test**. It adds a static source contract script, an acceptance matrix and optional read-only SQL. It performs no Auth provisioning, mutation, email or network calls.

## Local usage

1. Extract into `C:\dev\atom-app` (it creates `scripts` and `docs` files).
2. `node .\scripts\check-registration-static.cjs`
3. `git diff --check`; `npx tsc --noEmit`; `npm run build` (before commit).
4. Review the acceptance matrix, then execute functional cases on isolated test infrastructure only.

The source contract checks look for expected filenames/strings and may yield false positives or negatives. They prove **presence of code patterns only**; they do not establish RBAC effectiveness, route behavior, SQL atomicity, email delivery or legal compliance. Do not enable production feature flags because the static check passes.
