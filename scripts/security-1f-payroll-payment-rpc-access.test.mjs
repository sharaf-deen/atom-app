#!/usr/bin/env node
// Security Hardening 1F: read-only payroll RPC security contract.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync(
  'supabase/migrations/20261106123000_security_hardening_1f_payroll_payment_rpc_revoke.sql',
  'utf8',
)
const route = readFileSync('src/app/api/staff-payroll/payments/route.ts', 'utf8')

test('salary payment and reversal RPCs are server-only', () => {
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION/)
  assert.match(sql, /public\.staff_payroll_record_salary_payment\(uuid, uuid, numeric, text, date, text, text\)/)
  assert.match(sql, /public\.staff_payroll_reverse_salary_payment\(uuid, uuid, text\)/)
  assert.match(sql, /FROM PUBLIC, anon, authenticated;/)
  assert.doesNotMatch(sql, /FROM\s+service_role|DROP\s+FUNCTION|TRUNCATE|DELETE\s+FROM/)
  assert.match(route, /actor\.role !== 'super_admin'/)
  assert.match(route, /admin\.rpc\(\s*'staff_payroll_record_salary_payment'/)
  assert.match(route, /admin\.rpc\(\s*'staff_payroll_reverse_salary_payment'/)
})
