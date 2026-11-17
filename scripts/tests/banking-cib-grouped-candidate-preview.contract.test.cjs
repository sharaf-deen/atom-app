const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const api=fs.readFileSync('src/app/api/admin/banking/cib-payment-preview/route.ts','utf8')
const ui=fs.readFileSync('src/components/admin/banking/CibPaymentPreviewUploader.tsx','utf8')

test('grouped CIB review never writes to financial tables',()=>{
  assert.match(api,/me\.role !== 'super_admin'/)
  assert.doesNotMatch(api,/\.insert\(|\.update\(|\.upsert\(|\.delete\(/)
  assert.match(api,/read_only:true/)
})
test('bounded combinatorial group search supports up to four payments and detects exact integer cents',()=>{
  assert.match(api,/chosen\.length >= 4/)
  assert.match(api,/walk\(0,transaction\.amount_cents\)/)
  assert.match(api,/remaining-item\.amount_cents/)
  assert.match(api,/groups\.length >= 12/)
  assert.match(api,/iterations >= 80000/)
  assert.match(api,/nearby\.slice\(0,40\)/)
  assert.match(api,/truncated:|truncated =/)
})
test('groups expose cross CIB row conflicts and cannot imply confirmed reconciliation',()=>{
  assert.match(api,/new Map<string,Set<number>>/)
  assert.match(api,/conflicts_with_other_cib_rows/)
  assert.match(ui,/Conflict: one or more payments/)
  assert.match(ui,/not validated/)
  assert.doesNotMatch(ui,/Confirm grouped|Automatically confirm/)
})
test('source data remains card-only with no card-number leak',()=>{
  assert.match(api,/eq\('payment_method','card'\)/)
  assert.doesNotMatch(ui,/cardnumber|card_number|cardNumber/)
})
