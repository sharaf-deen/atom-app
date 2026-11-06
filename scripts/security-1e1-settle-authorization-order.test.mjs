#!/usr/bin/env node
// Security Hardening 1E.1 — source-only settlement authorization order.
// No network calls, Supabase access, credentials, or financial writes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('settle denies unauthorized roles before privileged subscription reads', () => {
  const source = readFileSync('src/app/api/subscriptions/settle/route.ts', 'utf8')
  const handler = source.slice(source.indexOf('export async function POST(req: Request)'))
  const authenticated = handler.indexOf('supabase.auth.getUser()')
  const roleLookup = handler.indexOf(".select('role')")
  const permission = handler.indexOf('const canHandleDeskPayment = canCreateSubscription(role)')
  const denyGuard = handler.indexOf('if (!canHandleDeskPayment)')
  const privilegedClient = handler.indexOf('const admin = makeAdminClient()')
  const subscriptionRead = handler.indexOf(".from('subscriptions')")
  for (const [label, position] of Object.entries({ authenticated, roleLookup, permission, denyGuard, privilegedClient, subscriptionRead })) {
    assert.ok(position !== -1, 'Missing settlement guard/read step: ' + label)
  }
  assert.ok(authenticated < roleLookup, 'Resolve authenticated actor before role lookup')
  assert.ok(roleLookup < permission, 'Use server-side profile role to check permission')
  assert.ok(permission < denyGuard, 'Check front-desk capability before denying')
  assert.ok(denyGuard < privilegedClient, 'Reject unauthorized roles before privileged client creation')
  assert.ok(denyGuard < subscriptionRead, 'Reject unauthorized roles before reading any subscription')
  assert.match(handler.slice(denyGuard, privilegedClient), /return json\(403,/)
})
