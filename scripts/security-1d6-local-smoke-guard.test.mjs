#!/usr/bin/env node
// Security 1D.6: source-only safety contract. Never accesses network or secrets.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('destructive reset smoke refuses remote Supabase targets', () => {
  const source = readFileSync('scripts/smoke-post-reset.mjs', 'utf8')
  assert.match(source, /new URL\(url\)/)
  assert.match(source, /parsedApi\.protocol !== 'http:'/)
  assert.match(source, /\['127\.0\.0\.1', 'localhost'\]\.includes\(parsedApi\.hostname\)/)
  assert.match(source, /parsedApi\.port !== '54321'/)
  assert.match(source, /Refusing smoke test: isolated local Supabase API required/)
})
