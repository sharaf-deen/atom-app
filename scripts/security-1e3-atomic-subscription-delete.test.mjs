#!/usr/bin/env node
// 1E.3 static contract tests. Never invokes Supabase or deletes member data.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync(
  'supabase/migrations/20261106070000_security_hardening_1e3_atomic_subscription_delete_audit.sql',
  'utf8',
)
const revoke = readFileSync('supabase/migrations/20261106070010_security_hardening_1e3_atomic_delete_revoke.sql', 'utf8')
const grant = readFileSync('supabase/migrations/20261106070020_security_hardening_1e3_atomic_delete_grant.sql', 'utf8')
const privilegeAssertion = readFileSync('supabase/migrations/20261106070030_security_hardening_1e3_atomic_delete_assert.sql', 'utf8')
const route = readFileSync('src/app/api/subscriptions/delete/route.ts', 'utf8')

test('atomic deletion RPC enforces role and caller before writing', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.delete_subscription_with_audit_atomic\(/i)
  assert.match(sql, /SECURITY INVOKER/i)
  assert.match(sql, /SET search_path = ''/i)
  assert.match(sql, /current_user <> 'service_role'/)
  assert.match(sql, /v_role IS DISTINCT FROM 'super_admin'/)
  assert.match(revoke, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated;/i)
  assert.match(grant, /GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role;/i)
  assert.match(privilegeAssertion, /SECURITY_1E3_PUBLIC_RPC_EXECUTE/)
  assert.doesNotMatch(sql, /REVOKE ALL ON FUNCTION|GRANT EXECUTE ON FUNCTION|DO \$assert_1e3\$/i)
})

test('deletion and audit write are one function transaction with no swallowed errors', () => {
  const del = sql.indexOf('DELETE FROM public.subscriptions')
  const audit = sql.indexOf('INSERT INTO public.audit_logs')
  assert.ok(del !== -1 && audit > del)
  assert.match(sql, /RETURNING id, member_id INTO v_deleted_id, v_member_id/)
  assert.match(sql, /IF NOT FOUND THEN[\s\S]*'deleted', false/)
  assert.match(sql, /'subscription_deleted'/)
  assert.match(sql, /'audit_logged', true/)
  assert.doesNotMatch(sql, /EXCEPTION WHEN/i)
  assert.match(route, /admin\.rpc\('delete_subscription_with_audit_atomic'/)
  assert.doesNotMatch(route, /\.from\('subscriptions'\)\s*\.delete\(/)
  assert.doesNotMatch(route, /\.from\('audit_logs'\)\.insert\(/)
})
