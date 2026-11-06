#!/usr/bin/env node
// 1F regression contract; does not contact Supabase or mutate financial data.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20261106125000_security_hardening_1f_payroll_closeout_adjustments_rpc_revoke.sql','utf8')
const closeout = readFileSync('src/app/api/staff-payroll/payment-closeout/route.ts','utf8')
const adjustments = readFileSync('src/app/api/staff-payroll/adjustments/route.ts','utf8')

test('sensitive closeout and adjustment RPCs are callable only by server', () => {
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION/i)
  for (const sig of [
    'staff_payroll_close_payment_cycle(uuid, uuid, text)',
    'staff_payroll_reopen_payment_closeout(uuid, uuid, text)',
    'staff_payroll_create_monthly_adjustment(date, uuid, text, numeric, text, uuid)',
    'staff_payroll_void_monthly_adjustment(uuid, text, uuid)',
  ]) assert.ok(sql.includes('public.' + sig), 'Missing '+sig)
  assert.match(sql, /FROM PUBLIC, anon, authenticated;/)
  assert.doesNotMatch(sql, /FROM\s+service_role|DROP\s+FUNCTION|TRUNCATE|DELETE\s+FROM/)
  assert.match(closeout, /actor\.role !== 'super_admin'/)
  assert.match(adjustments, /actor\.role !== 'super_admin'/)
  for (const name of ['staff_payroll_close_payment_cycle','staff_payroll_reopen_payment_closeout']) assert.ok(closeout.includes("'"+name+"'"))
  for (const name of ['staff_payroll_create_monthly_adjustment','staff_payroll_void_monthly_adjustment']) assert.ok(adjustments.includes("'"+name+"'"))
})
