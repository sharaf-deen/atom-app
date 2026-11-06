#!/usr/bin/env node
// Security Hardening 1F: read-only access-control migration contract.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync(
  'supabase/migrations/20261106121000_security_hardening_1f_store_privileged_rpc_revoke.sql',
  'utf8',
)

test('privileged Store write functions are not callable as anonymous or authenticated users', () => {
  assert.match(sql, /REVOKE\s+EXECUTE\s+ON\s+FUNCTION/i)
  assert.match(sql, /public\.admin_apply_store_sale_update\(uuid, text, integer, text, text\)/)
  assert.match(sql, /public\.admin_complete_store_preorder_as_sale\(uuid, text, uuid\)/)
  assert.match(sql, /FROM\s+PUBLIC,\s*anon,\s*authenticated;/i)
  assert.doesNotMatch(sql, /FROM[\s\S]*service_role/i)
  assert.doesNotMatch(sql, /(?:DROP\s+FUNCTION|ALTER\s+FUNCTION|DELETE\s+FROM|TRUNCATE)/i)
})
