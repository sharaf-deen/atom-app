# DB Reset + Smoke — registry authentication hotfix

Changes only `.github/workflows/db-smoke.yml`.

The existing CI already uses `SUPABASE_INTERNAL_IMAGE_REGISTRY: ghcr.io`, but didn't log in. The patch uses the job-scoped GitHub Actions token to authenticate to GHCR before starting the local Supabase stack.

This is a targeted mitigation, not a guarantee: if the image being rate-limited is hosted by Docker Hub or another registry, inspect the earlier `docker pull`/Supabase CLI lines to identify the registry; do not add permanent secrets or unlimited retries. For untrusted fork PRs, GitHub token access to private packages may be restricted.

Workflow permissions are limited to `contents: read` and `packages: read`. No Supabase hosted instance, application logic, or database is modified.

## Install on local branch

1. Make sure local `staging` is up-to-date and clean.
2. Create a branch `hotfix-db-smoke-registry-auth`.
3. Extract the ZIP at the repo root.
4. Check `git diff --check`, `npx tsc --noEmit`, `npm run build` before commit.
5. Stage ONLY `.github/workflows/db-smoke.yml` and `README_CI_DB_SMOKE.md`.
6. Push branch and open a PR against staging; inspect the new job logs.
