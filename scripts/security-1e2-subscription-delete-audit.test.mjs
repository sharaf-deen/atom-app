#!/usr/bin/env node
// Security 1E.2 regression evolved for 1E.3: no standalone deletion/audit writes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('subscription deletion remains Super Admin only and delegates to atomic RPC', () => {
  const route = readFileSync('src/app/api/subscriptions/delete/route.ts', 'utf8')
  const auth = route.indexOf('supa.auth.getUser()')
  const roleGuard = route.indexOf('if (!canManagePayments(role))')
  const rpc = route.indexOf(".rpc('delete_subscription_with_audit_atomic'")
  assert.ok(auth !== -1 && roleGuard > auth && rpc > roleGuard)
  assert.match(route, /p_actor_user_id: auth\.user\.id/)
  assert.match(route, /p_subscription_id: id/)
  assert.match(route, /if \(error\.code === '23514'\)/)
  assert.match(route, /SUBSCRIPTION_HISTORY_PROTECTED/)
  assert.match(route, /return json\(200, \{ ok: true, audit_logged: true \}\)/)
  assert.doesNotMatch(route, /\.from\('subscriptions'\)\s*\.delete\(/)
  assert.doesNotMatch(route, /\.from\('audit_logs'\)\.insert\(/)
})
