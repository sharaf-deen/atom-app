// Run: node --test scripts/tests/whatsapp-webhook-integrity.test.cjs
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const statusSource = fs.readFileSync('src/lib/whatsappWebhookStatus.ts', 'utf8')
const js = ts.transpileModule(statusSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const scope = { exports: {} }
vm.runInNewContext(js, scope)
const allowed = scope.exports.allowedWhatsAppPriorStatuses
test('delivery state is monotone for retries and out-of-order statuses', () => {
  assert.equal(allowed('sent').includes('read'), false)
  assert.equal(allowed('delivered').includes('read'), false)
  assert.equal(allowed('failed').includes('delivered'), false)
  assert.equal(allowed('read').includes('delivered'), true)
  assert.equal(allowed('sent').includes('queued'), true)
  assert.equal(allowed('bad_event').length, 0)
})
test('webhook enforces authenticity, account binding and atomic status guard', () => {
  const route = fs.readFileSync('src/app/api/webhooks/whatsapp/route.ts', 'utf8')
  assert.match(route, /verifyWhatsAppSignature\(raw,/)
  assert.match(route, /numberId!==process\.env\.WA_PHONE_NUMBER_ID/)
  assert.match(route, /\.in\('status',allowedPreviousStatuses\)/)
  assert.match(route, /insertError\.code!=='23505'/)
  assert.match(route, /Buffer\.byteLength\(raw,'utf8'\)/)
})
