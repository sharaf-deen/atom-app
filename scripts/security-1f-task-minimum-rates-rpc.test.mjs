#!/usr/bin/env node
// Security Hardening 1F: static least-privilege contract; no database writes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync(
  'supabase/migrations/20261106131000_security_hardening_1f_task_minimum_rates_rpc_revoke.sql',
  'utf8',
)
test('payroll task minimum rate writer cannot be directly invoked by client roles', () => {
  assert.match(sql, /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.staff_payroll_save_task_minimum_rates\(date,\s*jsonb,\s*jsonb,\s*uuid\)/i)
  assert.match(sql, /FROM\s+PUBLIC,\s*anon,\s*authenticated;/i)
  assert.doesNotMatch(sql, /FROM\s+service_role|DROP\s+FUNCTION|TRUNCATE|DELETE\s+FROM/i)
})
