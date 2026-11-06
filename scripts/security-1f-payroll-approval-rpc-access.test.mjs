#!/usr/bin/env node
// 1F: no network or DB writes; verifies server-only payroll RPC grants.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20261106124000_security_hardening_1f_payroll_approval_rates_rpc_revoke.sql', 'utf8')
const approval = readFileSync('src/app/api/staff-payroll/approval/route.ts', 'utf8')
const rates = readFileSync('src/app/api/staff-payroll/rates/route.ts', 'utf8')

test('privileged payroll approval and rates are server-only RPCs', () => {
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION/i)
  for (const name of ['staff_payroll_approve_snapshot', 'staff_payroll_reopen_snapshot', 'staff_payroll_save_rate_period']) {
    assert.ok(sql.includes('public.' + name + '('), 'Missing restricted function ' + name)
  }
  assert.match(sql, /FROM PUBLIC, anon, authenticated;/)
  assert.doesNotMatch(sql, /FROM\s+service_role|DROP\s+FUNCTION|DELETE\s+FROM|TRUNCATE/i)
  assert.match(approval, /actor\.role !== 'super_admin'/)
  assert.match(rates, /actor\.role !== 'super_admin'/)
  assert.match(approval, /admin\.rpc\(\s*'staff_payroll_approve_snapshot'/)
  assert.match(approval, /admin\.rpc\(\s*'staff_payroll_reopen_snapshot'/)
  assert.match(rates, /admin\.rpc\(\s*'staff_payroll_save_rate_period'/)
})
