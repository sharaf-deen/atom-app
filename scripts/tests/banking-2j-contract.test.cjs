const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const source = path => readFileSync(path, 'utf8')

test('Banking 2J InstaPay bulk requires distinct documented pairs and Super Admin', () => {
 const api = source('src/app/api/admin/banking/reconciliation/bulk-v3/route.ts')
 const sql = source('supabase/migrations/20261109150000_banking_2j_verified_instapay_bulk.sql')
 for (const token of ["me.role !== 'super_admin'", 'body.verified !== true','credits.has(credit)','batches.has(batch)','evidence.trim().length < 15']) {
   assert.ok(api.includes(token), 'API missing: ' + token)
 }
 for (const token of ["lock table public.bank_payment_matches","v_batch.payment_method <> 'instapay'","v_tx.description not ilike 'IPN Inward%'","PAIR_EVIDENCE_REQUIRED","ALREADY_MATCHED","LEGACY_BATCH_MATCHED","to service_role"]) {
   assert.ok(sql.includes(token), 'SQL missing: ' + token)
 }
 assert.ok(sql.includes('abs(v_tx.transaction_date-v_batch.business_date)>3'))
 assert.ok(!sql.includes('payment_method in (\'instapay\',\'bank_transfer\',\'card\')'))
})

test('Banking 2J shows CIB as read-only hypothetical settlement evidence', () => {
 const ui = source('src/components/admin/banking/BankAssistedBulk2J.tsx')
 const page = source('src/app/admin/banking/reconciliation/page.tsx')
 assert.ok(ui.includes('Merchant settlement statement is required'))
 assert.ok(ui.includes('Fee estimates are NOT confirmed'))
 assert.ok(ui.includes('No preselected pairs'))
 assert.ok(ui.includes('bulk-v3'))
 assert.ok(ui.includes('new Set(selectedBatchIds)'))
 assert.ok(page.includes('<BankAssistedBulk2J'))
 assert.ok(page.includes('Legacy tools — Banking 2H / 2I'))
})
