#!/usr/bin/env node
// Security Hardening 1F: source-only contract; no network or database writes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync(
  'supabase/migrations/20261106120000_security_hardening_1f_financial_view_revoke.sql',
  'utf8',
)

test('financial income view is no longer directly readable by client roles', () => {
  assert.match(migration, /REVOKE\s+SELECT\s+ON\s+TABLE\s+public\.admin_income_events_open_v1\s+FROM\s+anon,\s*authenticated;/i)
  assert.doesNotMatch(migration, /REVOKE[\s\S]*FROM\s+service_role/i)
  assert.doesNotMatch(migration, /DROP\s+(?:VIEW|TABLE)|DELETE\s+FROM|TRUNCATE/i)
})
