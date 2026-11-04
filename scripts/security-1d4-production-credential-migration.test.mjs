#!/usr/bin/env node
// Production credential migration source audit. No network or secret reads.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name)
    if (entry.isDirectory()) yield* sourceFiles(file)
    else if (entry.isFile() && /\.(?:ts|tsx|js|jsx)$/.test(entry.name)) yield file
  }
}

test('production app source contains no direct legacy service key lookups', () => {
  const violations = []
  for (const file of sourceFiles('src')) {
    if (file.replaceAll('\\', '/') === 'src/lib/supabaseAdmin.ts') continue
    const content = readFileSync(file, 'utf8')
    if (/process\.env(?:\.|\[['"])SUPABASE_SERVICE_ROLE_KEY/.test(content))
      violations.push(file)
  }
  assert.deepEqual(violations, [], 'Direct legacy service key remains in app source')
})

test('central key resolver prefers modern key; Production does not force new gate', () => {
  const source = readFileSync('src/lib/supabaseAdmin.ts', 'utf8')
  assert.match(source, /process\.env\.SUPABASE_SECRET_KEY\?\.trim\(\)/)
  assert.match(source, /modernKey \|\| process\.env\.SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(source, /process\.env\.ATOM_REQUIRE_MODERN_SUPABASE_KEY === '1'/)
})
