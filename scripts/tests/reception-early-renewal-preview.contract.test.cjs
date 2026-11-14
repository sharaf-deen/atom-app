// Consolidated read-only contract for Reception/Admin early renewal.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const read = (p) => fs.readFileSync(p, 'utf8')
const home = read('src/app/members/[id]/page.tsx')
const dialog = read('src/components/SubscribeDialog.tsx')
const renew = read('src/app/api/subscriptions/renew/route.ts')
const rbac = read('src/lib/rbac.ts')

test('Reception, Admin and Super Admin retain Renew / Extend; new subscription is blocked while active', () => {
  assert.match(home, /const STAFF: Role\[\] = \['reception', 'admin', 'super_admin'\]/)
  assert.match(home, /const canCreateSubscription = STAFF.includes\(me.role\)/)
  assert.match(home, /buttonLabel="Renew \/ Extend"/)
  assert.match(home, /mode="renew"/)
  assert.match(home, /currentEndDate=\{maxActiveTimeEnd\}/)
  assert.match(home, /lockStartDate/)
  assert.match(home, /disabled=\{hasActiveSubscription \|\| legalSubscriptionBlocked\}/)
  assert.match(rbac, /export function canCreateSubscription/)
})

test('Renewal shows current expiry, locked automatic start and calculated end before confirmation', () => {
  assert.match(dialog, /aria-label="Renewal date preview"/)
  for (const label of ['Current plan ends', 'New plan starts', 'New plan ends']) {
    assert.ok(dialog.includes(label), label)
  }
  assert.match(dialog, /currentEndDate \?\? '—'/)
  assert.match(dialog, /lockStartDate \? 'Start date \(auto\)'/)
  assert.match(dialog, /disabled=\{busy \|\| status.kind === 'success' \|\| lockStartDate\}/)
  assert.match(dialog, /mode === 'renew' \? \[/)
  assert.match(dialog, /mode === 'renew' \? 'This renewal creates a new subscription/)
})

test('Stale preview is rejected before any subscription transaction, no loss of days', () => {
  assert.match(dialog, /body.expected_start_date = startDate/)
  assert.match(renew, /const expectedStartDate = body\?\.expected_start_date/)
  assert.match(renew, /if \(expectedStartDate !== payload.start_date\)/)
  assert.match(renew, /error: 'RENEWAL_DATES_CHANGED'/)
  assert.ok(renew.indexOf("error: 'RENEWAL_DATES_CHANGED'") < renew.indexOf("'atom_create_subscription_idempotent'"))
  assert.match(renew, /maxActiveTimeEnd \? addDays\(maxActiveTimeEnd, 1\) : startBase/)
  assert.match(renew, /canCreateSubscription\(role\)/)
  assert.match(renew, /getMemberLegalCompliance/)
  assert.match(renew, /'atom_create_subscription_idempotent'/)
  assert.match(dialog, /const actualStart = j\?\.start_date \|\| startDate/)
})
