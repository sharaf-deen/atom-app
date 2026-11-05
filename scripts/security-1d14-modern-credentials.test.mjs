#!/usr/bin/env node
// Security Hardening 1D.14: source-only, secret-free modern credential contract.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const resolver = readFileSync('src/lib/supabaseAdmin.ts', 'utf8')
const envExample = readFileSync('.env.example', 'utf8')

test('privileged client requires modern Supabase secret key', () => {
  assert.match(resolver, /process\.env\.SUPABASE_SECRET_KEY\?\.trim\(\)/)
  assert.match(resolver, /modernKey\.startsWith\('sb_secret_'\)/)
  assert.match(resolver, /if \(!modernKey\)/)
  assert.match(resolver, /Modern server-side Supabase secret key required/)
  assert.doesNotMatch(resolver, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/)
  assert.doesNotMatch(resolver, /modernKey\s*\|\|/)
})

test('documented credentials use modern key formats only', () => {
  assert.match(envExample, /NEXT_PUBLIC_SUPABASE_ANON_KEY=your_sb_publishable_key/)
  assert.match(envExample, /SUPABASE_SECRET_KEY=your_sb_secret_key/)
  assert.doesNotMatch(envExample, /^SUPABASE_SERVICE_ROLE_KEY=/m)
})
