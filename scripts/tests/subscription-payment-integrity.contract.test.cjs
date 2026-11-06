// Source contract tests (no database connection required).
// Run with: node --test scripts/tests/subscription-payment-integrity.contract.test.cjs
// These guard important source-level invariants; PostgreSQL integration tests
// are still mandatory before any migration or production deployment.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')

const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')
const route = read('src/app/api/subscriptions/update/route.ts')
const correction = read('src/app/api/subscriptions/payments/correct-method/route.ts')
const sql = read('scripts/sql/subscription-payment-method-correction-DRAFT.sql')

test('subscription header finance edits are rejected when ledger payments exist', () => {
  assert.match(route, /financialHeaderChange/)
  assert.match(route, /\.from\('subscription_payments'\)/)
  assert.match(route, /PAYMENT_LEDGER_CORRECTION_REQUIRED/)
  assert.match(route, /return json\(409,/)
})

test('only super admin may invoke correction endpoint', () => {
  assert.match(correction, /normalizeRole\(profile\?\.role\) !== 'super_admin'/)
  assert.match(correction, /SUPER_ADMIN_REQUIRED/)
  assert.match(correction, /p_actor: auth\.user\.id/)
})

test('correction endpoint requires payment ID, distinct methods, and explanation', () => {
  assert.match(correction, /payment_id/)
  assert.match(correction, /oldMethod === newMethod/)
  assert.match(correction, /reason\.length < 5/)
  assert.match(correction, /reason\.length > 500/)
})

test('database correction is scoped to a single payment with stale-value protection', () => {
  assert.match(sql, /where id = p_payment_id for update/)
  assert.match(sql, /is distinct from v_old_method/)
  assert.match(sql, /update public\.subscription_payments set payment_method = v_new_method/)
})

test('matched batches, refund workflows and multi-payment validation are guarded', () => {
  assert.match(sql, /public\.membership_refunds/)
  assert.match(sql, /public\.reconciliation_bank_matches/)
  assert.match(sql, /v_item_count <> 1/)
  assert.match(sql, /released_at = v_now, released_by = p_actor/)
})

test('database function denies direct public execution and logs method changes', () => {
  assert.match(sql, /revoke all on function public\.correct_subscription_payment_method_v1/)
  assert.match(sql, /from public, anon, authenticated/)
  assert.match(sql, /public\.subscription_payment_method_corrections/)
  assert.match(sql, /corrected_by/)
})

test('draft is not shipped as an executable migration', () => {
  assert.match(sql, /DRAFT ONLY/)
  assert.match(sql, /NOT A MIGRATION/)
  assert.doesNotMatch(correction, /create or replace function/i)
})
