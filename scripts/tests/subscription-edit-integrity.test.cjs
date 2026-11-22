const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const Module = require('node:module')
const path = require('node:path')

const file = 'src/lib/subscriptionEditIntegrity.ts'
const source = fs.readFileSync(file,'utf8')
const js = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
const loaded = new Module(path.resolve(file),module)
loaded._compile(js,path.resolve(file))
const {changedSubscriptionFields,classifySubscriptionEdit,subscriptionEditConflict} = loaded.exports
const initial = {
  plan:'12m',start_date:'2026-11-12',end_date:'2027-11-12',status:'active',
  sessions_total:null,amount:7100,amount_due:7300,payment_method:'cash',
}
test('sending unchanged editor fields never constitutes an upgrade or cash correction',()=>{
 assert.deepEqual(changedSubscriptionFields(initial,{plan:'12m',start_date:'2026-11-12',amount:7100,payment_method:'cash'}),[])
 assert.deepEqual(changedSubscriptionFields(initial,{plan:'12m',start_date:'2026-11-15'}),['start_date'])
})
test('real changes are classified as contract or finance',()=>{
 assert.deepEqual(classifySubscriptionEdit(changedSubscriptionFields(initial,{plan:'6m'})),
  {financial:false,contract:true,sensitive:true})
 assert.deepEqual(classifySubscriptionEdit(changedSubscriptionFields(initial,{amount:15000})),
  {financial:true,contract:false,sensitive:true})
 assert.deepEqual(classifySubscriptionEdit(changedSubscriptionFields(initial,{payment_method:'card',end_date:'2027-12-12'})),
  {financial:true,contract:true,sensitive:true})
})
test('linked accounting or contract history blocks standard Edit',()=>{
 const args={changes:['plan'],hasPayments:false,hasInvoices:false,hasUpgrades:false,hasRefunds:false,
   hasFreezes:false,hasOpenRenewals:false}
 assert.equal(subscriptionEditConflict(args),null)
 assert.equal(subscriptionEditConflict({...args,changes:[] ,hasUpgrades:true}),null)
 for(const [flag,code] of [
  ['hasPayments','PAYMENT_LEDGER_CORRECTION_REQUIRED'],
  ['hasInvoices','INVOICED_SUBSCRIPTION_REQUIRES_CORRECTION_WORKFLOW'],
  ['hasUpgrades','UPGRADED_SUBSCRIPTION_IMMUTABLE'],
  ['hasRefunds','SUBSCRIPTION_REFUND_REQUIRES_REVIEW'],
  ['hasFreezes','FREEZE_HISTORY_CONFLICT'],
  ['hasOpenRenewals','OPEN_RENEWAL_REQUEST_REQUIRES_REVIEW'],
 ]) {
   assert.equal(subscriptionEditConflict({...args,[flag]:true}),code)
 }
})
test('the server rejects all financial edits and linked contract changes even from direct API calls',()=>{
 const route=fs.readFileSync('src/app/api/subscriptions/update/route.ts','utf8')
 assert.match(route,/FINANCIAL_EDIT_REQUIRES_DEDICATED_WORKFLOW/)
 assert.match(route,/FINANCIALLY_COMMITTED_CONTRACT_LOCKED/)
 assert.match(route,/UPGRADED_SUBSCRIPTION_IMMUTABLE|subscriptionEditConflict\(/)
 assert.match(route,/SUPER_ADMIN_CORRECTION_REQUIRED/)
 assert.match(route,/CORRECTION_REASON_REQUIRED/)
 assert.match(route,/CORRECTION_AUDIT_NOT_RECORDED/)
 assert.match(route,/INVOICE_REISSUE_REQUIRES_DEDICATED_WORKFLOW/)
 for(const table of ['subscription_payments','invoices','membership_upgrades','membership_refunds',
  'subscription_freezes','membership_renewal_requests'])assert.ok(route.includes(table),table)
})
test('editor never sends financial fields or invoice replacement requests',()=>{
 const ui=fs.readFileSync('src/components/SubscriptionManageRowActions.tsx','utf8')
 assert.doesNotMatch(ui,/patch\.amount =/)
 assert.doesNotMatch(ui,/patch\.payment_method =/)
 assert.match(ui,/disabled=\{busy \|\| contractReadOnly\}/)
 assert.match(ui,/correction_reason:correctionReason\.trim\(\)/)
 assert.doesNotMatch(ui,/Re-issue invoice/)
})
