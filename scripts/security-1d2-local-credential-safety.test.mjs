#!/usr/bin/env node
// Security Hardening 1D.2: local-only destructive smoke safety contracts.
// Source-level checks only; no network or Supabase access.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('post-reset smoke refuses any non-loopback Supabase URL', () => {
  const source = readFileSync('scripts/smoke-post-reset.mjs', 'utf8')
  assert.match(source, /new URL\(url\)/)
  assert.match(source, /parsedApi\.protocol !== 'http:'/)
  assert.match(source, /\['127\.0\.0\.1', 'localhost'\]\.includes\(parsedApi\.hostname\)/)
  assert.match(source, /parsedApi\.port !== '54321'/)
  assert.match(source, /Refusing smoke test: isolated local Supabase API required/)
})

test('isolated financial E2E retains its explicit local-only guard', () => {
  const source = readFileSync('scripts/security-1c7-local-financial-auth-e2e.mjs', 'utf8')
  assert.match(source, /ATOM_LOCAL_FINANCIAL_E2E/)
  assert.match(source, /Refusing nonlocal Supabase API/)
  assert.match(source, /SUPABASE_SECRET_KEY:service/)
  assert.match(source, /delete startEnv\.SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(source, /Missing modern local Supabase secret key/)
})
