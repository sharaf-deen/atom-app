const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const vm=require('node:vm')
const ts=require('typescript')
const pdfLib=require('pdf-lib')
function loadTs(path,modules) {
 const source=fs.readFileSync(path,'utf8')
 const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText
 const out={exports:{}}
 vm.runInNewContext(code,{module:out,exports:out.exports,require:(key)=>{
  if(key in modules)return modules[key]
  throw new Error('UNEXPECTED_REQUIRE '+key)
 },crypto:require('node:crypto').webcrypto,Buffer,console})
 return out.exports
}
const inv=loadTs('src/lib/invoices.ts',{'pdf-lib':pdfLib})
const helper=loadTs('src/lib/membershipUpgradeInvoice.ts',{'@/lib/invoices':inv})
const member='18f0a1b2-2c3d-4e5f-8a9b-000000000002'
const sub='18f0a1b2-2c3d-4e5f-8a9b-000000000003'
const old='18f0a1b2-2c3d-4e5f-8a9b-000000000004'
const upgradeId='18f0a1b2-2c3d-4e5f-8a9b-000000000005'
const paymentId='18f0a1b2-2c3d-4e5f-8a9b-000000000006'
function setup() {
 const tables={
  membership_upgrades:[{id:upgradeId,member_id:member,from_subscription_id:old,to_subscription_id:sub,
   from_plan:'1m',to_plan:'3m',transferred_credit_egp:733.33,target_price_egp:5250,
   additional_payment_egp:4516.67,additional_payment_id:paymentId}],
  profiles:[{user_id:member,member_id:'ATOM-TEST',first_name:'STAGING',last_name:'TEST',email:'test@example.invalid',created_at:'2026-10-01T09:00:00Z'}],
  subscriptions:[{id:sub,plan:'3m',subscription_type:'time',start_date:'2026-11-22',end_date:'2027-02-22',sessions_total:null,amount:4516.67,amount_due:0,payment_method:'cash'}],
  subscription_payments:[{id:paymentId,subscription_id:sub,member_id:member,amount:4516.67,paid_at:'2026-11-15T10:00:00Z',payment_method:'cash'}],
  invoices:[],
 }
 const uploads=[]
 function from(table) {
  const filters=[]
  let inserted=null
  const b={
   select(){return b},
   eq(key,value){filters.push([key,value]);return b},
   limit(n){return Promise.resolve({data:tables[table].filter(row=>filters.every(([k,v])=>row[k]===v)).slice(0,n),error:null})},
   insert(data){inserted={id:'invoice-id',...data};tables[table].push(inserted);return b},
   maybeSingle(){return Promise.resolve({data:inserted||tables[table].find(row=>filters.every(([k,v])=>row[k]===v))||null,error:null})},
  }
  return b
 }
 const admin={from,storage:{from:()=>({upload:async(path,bytes,opts)=>{
   uploads.push({path,bytes,opts});return {error:null}
 }})}}
 return {tables,uploads,admin}
}
test('upgrade invoice is real PDF, cash-only receipt plus credit breakdown, and idempotent',async()=>{
 const {admin,tables,uploads}=setup()
 const first=await helper.ensureMembershipUpgradeInvoice(admin,upgradeId,member)
 assert.equal(first.invoice_number,inv.makeInvoiceNumber({paidAtISO:'2026-11-15T10:00:00Z',subscriptionId:sub}))
 assert.equal(tables.invoices.length,1)
 assert.equal(uploads.length,1)
 assert.equal(tables.invoices[0].amount,4516.67)
 assert.equal(tables.invoices[0].snapshot.transaction.paid_at,'2026-11-15T10:00:00Z')
 assert.equal(tables.invoices[0].snapshot.upgrade.transferred_credit_egp,733.33)
 assert.equal(tables.invoices[0].snapshot.upgrade.target_price_egp,5250)
 assert.equal(tables.invoices[0].snapshot.transaction.amount,4516.67)
 const parsed=await pdfLib.PDFDocument.load(uploads[0].bytes)
 assert.equal(parsed.getPageCount(),1)
 assert.equal(uploads[0].opts.upsert,false)
 const repeated=await helper.ensureMembershipUpgradeInvoice(admin,upgradeId,member)
 assert.equal(repeated.id,first.id)
 assert.equal(tables.invoices.length,1)
 assert.equal(uploads.length,1)
})
test('invoice refuses mismatched price or payment, without PDF upload',async()=>{
 const {admin,tables,uploads}=setup()
 tables.membership_upgrades[0].target_price_egp=5000
 await assert.rejects(()=>helper.ensureMembershipUpgradeInvoice(admin,upgradeId,member),/AMOUNT_MISMATCH/)
 assert.equal(uploads.length,0)
 tables.membership_upgrades[0].target_price_egp=5250
 tables.subscription_payments[0].amount=1
 await assert.rejects(()=>helper.ensureMembershipUpgradeInvoice(admin,upgradeId,member),/PAYMENT_MISMATCH/)
 assert.equal(tables.invoices.length,0)
})
