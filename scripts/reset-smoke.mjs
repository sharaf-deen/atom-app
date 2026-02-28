#!/usr/bin/env node
/**
 * One-command flow:
 * - Ensure Supabase stack is up
 * - DB-only reset (to avoid occasional Windows/Kong 502 healthcheck flakiness)
 * - Restart Supabase stack so PostgREST reloads schema cache (critical for DB-only reset)
 * - Run smoke-post-reset
 */
import { execSync } from 'node:child_process'
import process from 'node:process'

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', ...opts })
}

try {
  // Start (no-op if already running)
  run('npx supabase start')
} catch (e) {
  // If it's already running, some versions exit non-zero; ignore.
}

try {
  // DB-only reset keeps non-DB services running, so PostgREST schema cache may be stale.
  run('npx supabase db reset', {
    env: { ...process.env, SUPABASE_DB_ONLY: 'true' },
  })
} finally {
  delete process.env.SUPABASE_DB_ONLY
}

// IMPORTANT: restart stack so PostgREST (REST API) reloads schema cache after DB-only reset.
try {
  run('npx supabase stop --no-backup')
} catch (e) {
  // ignore
}
run('npx supabase start')

run('node scripts/smoke-post-reset.mjs')
