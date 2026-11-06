#!/usr/bin/env node
// Security Hardening 1E.2 — source-only regression for subscription deletion audit.
// Never calls an API or performs a real financial operation.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('subscription deletion requires Super Admin and records a bounded audit event', () => {
  const src = readFileSync('src/app/api/subscriptions/delete/route.ts', 'utf8')
  const route = src.slice(src.indexOf('export async function POST(req: Request)'))
  const auth = route.indexOf('supa.auth.getUser()')
  const privilege = route.indexOf('if (!canManagePayments(role))')
  const deletion = route.indexOf(".from('subscriptions')\n      .delete()")
  const audit = route.indexOf(".from('audit_logs').insert(")
  const response = route.indexOf('return json(200, { ok: true, audit_logged })')
  for (const [name, pos] of Object.entries({ auth, privilege, deletion, audit, response }))
    assert.ok(pos !== -1, 'Missing: ' + name)
  assert.ok(auth < privilege && privilege < deletion, 'Unauthorized actor must not delete')
  assert.ok(deletion < audit && audit < response, 'Only successful deletes should be audited')
  assert.match(route, /\.select\('id, member_id'\)/)
  assert.match(route, /if \(!deleted\) return json\(404,/)
  assert.match(route, /actor_user_id: auth\.user\.id/)
  assert.match(route, /target_user_id: deleted\.member_id/)
  assert.match(route, /action: 'subscription_deleted'/)
  assert.match(route, /subscription_id: deleted\.id/)
  assert.match(route, /audit_logged = !auditError/)
  assert.match(route, /SUBSCRIPTION_DELETE_AUDIT_FAILED/)
  assert.doesNotMatch(route, /console\.(?:log|error)\([^\n]*auth\.user\.id/)
})
