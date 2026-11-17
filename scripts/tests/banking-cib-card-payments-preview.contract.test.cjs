const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const api = fs.readFileSync('src/app/api/admin/banking/cib-payment-preview/route.ts','utf8')
const page = fs.readFileSync('src/app/admin/banking/cib-preview/page.tsx','utf8')

test('CIB individual matching is restricted to Super Admin and read-only',()=>{
  assert.match(api,/me\.role !== 'super_admin'/)
  assert.match(api,/read_only:true/)
  assert.doesNotMatch(api,/\.insert\(|\.update\(|\.upsert\(|\.delete\(/)
  assert.match(page,/CibPaymentPreviewUploader/)
})
test('CIB gross amounts are checked against exact ATOM amounts and Cairo dates',()=>{
  assert.match(api,/p\.amount_cents === transaction\.amount_cents/)
  assert.match(api,/dayDistance\(p\.date, transaction\.date\) <= 1/)
  assert.match(api,/timeZone:'Africa\/Cairo'/)
  assert.match(api,/status: 'reference_candidate' \| 'single_candidate' \| 'ambiguous' \| 'unmatched'/)
})
test('CIB account is verified and duplicate candidates are not treated as single matches',()=>{
  assert.match(api,/100075806935/)
  assert.match(api,/28276801/)
  assert.match(api,/const usage = new Map<string,number>/)
  assert.match(api,/match\.status = 'ambiguous'/)
  assert.match(api,/No payment, allocation, or reconciliation was confirmed/)
})
test('card and reference masks stay server-side',()=>{
  const ui = fs.readFileSync('src/components/admin/banking/CibPaymentPreviewUploader.tsx','utf8')
  assert.doesNotMatch(ui,/cardnumber|card_number|cardNumber/)
  assert.match(ui,/Candidates?|candidate/i)
})
