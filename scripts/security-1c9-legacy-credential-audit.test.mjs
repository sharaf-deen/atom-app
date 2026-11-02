#!/usr/bin/env node
/**
 * Security Hardening 1C.9 — exhaustive source-level legacy Supabase key audit.
 * Read-only; no credentials are loaded or printed, no network/database calls.
 * Scans application source, CI/scripts and Supabase functions at every test run.
 * Prevents newly introduced direct legacy key dependencies in application code.
 *
 * Legacy key fallback is permitted only in src/lib/supabaseAdmin.ts until the
 * final cross-environment dependency audit explicitly authorizes revocation.
 * The local Supabase smoke harness is an intentionally separate dependency.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const roots = ['src', 'scripts', '.github/workflows', 'supabase/functions']
const extensions = /\.(?:ts|tsx|js|jsx|mjs|cjs|yml|yaml|json|toml|sh|ps1)$/
const centralClient = 'src/lib/supabaseAdmin.ts'
const localOnly = new Set([
  'scripts/smoke-post-reset.mjs',
  'scripts/security-1c7-local-financial-auth-e2e.mjs',
  'scripts/security-1c5-financial-http-smoke.mjs',
  'scripts/security-1c1-contract.test.mjs',
  'scripts/security-1c9-legacy-credential-audit.test.mjs',
])

function* files(dir) {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!['node_modules','.next','.git','dist','build'].includes(entry.name)) yield* files(file)
      } else if (entry.isFile() && extensions.test(entry.name)) {
        yield file
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}
const matching = []
const unsafe = []
let scanned = 0
for (const root of roots) {
  for (const filename of files(root)) {
    scanned++
    const path = relative('.', filename).replaceAll('\\','/')
    const lines = readFileSync(filename, 'utf8').split(/\r?\n/)
    lines.forEach((line, index) => {
      if (!/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|NEXT_PUBLIC_SUPABASE_SECRET_KEY|sb_secret_/.test(line)) return
      const record = { path, line: index + 1 }
      matching.push(record)
      // Any browser-exposed secret naming is prohibited; exclude only test
      // assertions that explicitly deny this string.
      if (/NEXT_PUBLIC_SUPABASE_SECRET_KEY/.test(line)
          && !/doesNotMatch|assert\.|NEXT_PUBLIC_SUPABASE_SECRET_KEY.*prohibit/.test(line)) {
        unsafe.push({ ...record, reason: 'privileged key exposed as NEXT_PUBLIC' })
      }
      // Production/server source must not read legacy credentials directly,
      // except in the centralized compatibility client.
      if (path.startsWith('src/') && path !== centralClient
          && /(?:process\.env\.|process\.env\[|\bDeno\.env\.get\s*\(|\bBun\.env\.)/.test(line)
          && /SUPABASE_SERVICE_ROLE_KEY/.test(line)) {
        unsafe.push({ ...record, reason: 'direct legacy key in application source' })
      }
      // Static references in script documentation are not production use.
      if (path.startsWith('scripts/') && !localOnly.has(path)
          && /process\.env\.SUPABASE_SERVICE_ROLE_KEY/.test(line)) {
        unsafe.push({ ...record, reason: 'new non-allowlisted script dependency' })
      }
      if (path.startsWith('.github/')
          && /\bsecrets\.SUPABASE_SERVICE_ROLE_KEY\b/.test(line)) {
        unsafe.push({ ...record, reason: 'GitHub workflow directly requires legacy key' })
      }
    })
  }
}

test('legacy Supabase key references remain centralized and audited', () => {
  assert.ok(scanned > 150, 'Source scanner unexpectedly omitted application files')
  const groups = new Map()
  for (const m of matching) groups.set(m.path, (groups.get(m.path) ?? 0) + 1)
  console.log('Legacy credential audit scanned', scanned, 'source/config files')
  for (const [path, count] of [...groups].sort(([a],[b]) => a.localeCompare(b))) {
    console.log('  CREDENTIAL_REFERENCE', path, '(' + count + ')')
  }
  console.log('No credential values, hashes or environment secrets are emitted.')
  assert.deepEqual(unsafe, [], 'Unexpected direct legacy credential use: ' + JSON.stringify(unsafe))
})
