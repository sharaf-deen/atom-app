#!/usr/bin/env node
// Security Hardening 1C.2 — source-contract regressions.
// These checks NEVER connect to Supabase, modify data, or invoke financial routes.
// They are deliberately NOT a substitute for isolated authenticated write-path E2E tests.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(resolve(root, p), 'utf8')
const routes = {
  'subscription creation': 'src/app/api/subscriptions/create/route.ts',
  'subscription renewal': 'src/app/api/subscriptions/renew/route.ts',
  'subscription settlement': 'src/app/api/subscriptions/settle/route.ts',
  'subscription freeze': 'src/app/api/subscriptions/freeze/route.ts',
  'subscription update': 'src/app/api/subscriptions/update/route.ts',
  'subscription delete': 'src/app/api/subscriptions/delete/route.ts',
  'refund subscription impact': 'src/app/api/membership-refunds/subscription-impact/route.ts',
}
const privilegeGate = {
  'subscription creation': /canCreateSubscription\(role\)/,
  'subscription renewal': /canCreateSubscription\(role\)/,
  'subscription settlement': /canHandleDeskPayment\s*=\s*canCreateSubscription\(role\)/,
  'subscription freeze': /profile\?\.role\s*!==\s*'super_admin'/,
  'subscription update': /canManageSubscriptions\(role\)/,
  'subscription delete': /canManagePayments\(role\)/,
  'refund subscription impact': /role\s*!==\s*'super_admin'/,
}
const criticalRPCs = {
  'subscription creation': ['atom_subscription_idempotency_lookup', 'atom_create_subscription_idempotent'],
  'subscription renewal': ['atom_subscription_idempotency_lookup', 'atom_create_subscription_idempotent'],
  'subscription freeze': ['manage_subscription_freeze_atomic'],
  'refund subscription impact': ['apply_membership_refund_impact_atomic'],
}

test('central privileged client prefers modern secret and fails closed on malformed modern key', () => {
  const s = read('src/lib/supabaseAdmin.ts')
  assert.match(s, /process\.env\.SUPABASE_SECRET_KEY\?\.trim\(\)/)
  assert.match(s, /!modernKey\.startsWith\('sb_secret_'\)/)
  assert.match(s, /throw new Error\('Invalid server-side Supabase secret key configuration'\)/)
  assert.match(s, /if \(!modernKey\)/)
  assert.match(s, /throw new Error\('Modern server-side Supabase secret key required'\)/)
  assert.match(s, /return modernKey/)
  assert.doesNotMatch(s, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/)
  assert.doesNotMatch(s, /NEXT_PUBLIC_SUPABASE_SECRET_KEY/)
})

for (const [name, path] of Object.entries(routes)) {
  test(`${name}: centralized secret client, auth guard, role gate, and no legacy direct lookup`, () => {
    const s = read(path)
    assert.match(s, /import \{ createSupabaseAdminClient \} from ['"]@\/lib\/supabaseAdmin['"]/)
    assert.match(s, /createSupabaseAdminClient\(\)/)
    assert.doesNotMatch(s, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/)
    assert.doesNotMatch(s, /createClient\s*\(/)
    assert.match(s, /\.auth\.getUser\(\)/)
    assert.match(s, privilegeGate[name])
    assert.match(s, /\b403\b/)
    for (const rpc of criticalRPCs[name] ?? []) assert.ok(s.includes(rpc), `Missing required RPC: ${rpc}`)
  })
}

test('public registration must keep a fail-closed submit feature gate', () => {
  const s = read('src/app/api/public-registration/submit/route.ts')
  assert.match(s, /ATOM_PUBLIC_REGISTRATION_SUBMIT_ENABLED/)
  assert.match(s, /createSupabaseAdminClient\(\)/)
})
