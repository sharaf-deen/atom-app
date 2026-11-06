#!/usr/bin/env node
// Security Hardening 1F: source-only regression; no network/database writes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const base = 'supabase/migrations/'
const expected = [
  ['20261106122000_security_hardening_1f_expenses_insert_guard.sql', 'expenses_insert_ops', 'expenses', 'WITH CHECK'],
  ['20261106122010_security_hardening_1f_expenses_update_guard.sql', 'expenses_update_ops', 'expenses', 'WITH CHECK'],
  ['20261106122020_security_hardening_1f_expenses_delete_guard.sql', 'expenses_delete_admin', 'expenses', 'USING'],
  ['20261106122030_security_hardening_1f_payments_insert_guard.sql', 'payments_insert_ops', 'payments', 'WITH CHECK'],
  ['20261106122040_security_hardening_1f_payments_update_guard.sql', 'payments_update_ops', 'payments', 'WITH CHECK'],
  ['20261106122050_security_hardening_1f_payments_delete_guard.sql', 'payments_delete_admin', 'payments', 'USING'],
]
test('restrict direct financial mutations to Super Admin without removing read policies', () => {
  for (const [filename, policy, table, clause] of expected) {
    const sql = readFileSync(base + filename, 'utf8')
    assert.match(sql, new RegExp('ALTER\\s+POLICY\\s+' + policy + '\\s+ON\\s+public\\.' + table, 'i'))
    assert.ok(sql.includes(clause), filename + ': missing ' + clause)
    assert.match(sql, /public\.is_super_admin\(\(select auth\.uid\(\)\)\)/i)
    assert.doesNotMatch(sql, /is_ops\(|is_admin_or_super_admin\(/i)
    assert.doesNotMatch(sql, /DROP\s+POLICY|CREATE\s+POLICY|REVOKE|DELETE\s+FROM|TRUNCATE/i)
    assert.equal((sql.match(/ALTER POLICY /g) || []).length, 1)
  }
})
