const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const read=p=>fs.readFileSync(p,'utf8')
const member=read('src/app/api/membership-renewal-requests/route.ts')
const admin=read('src/app/api/admin/membership-renewal-requests/route.ts')
const proof=read('src/app/api/membership-renewal-requests/proofs/route.ts')
const quote=read('src/lib/membershipRenewalQuote.ts')
const sql=read('supabase/migrations/20261119080000_membership_renewal_requests_v1.sql')
const ui=read('src/components/members/MembershipRenewalRequestsClient.tsx')
test('pricing is server derived from existing packages and opt-in promotions',()=>{
 assert.match(quote,/from\('packages_pricing'\)/)
 assert.match(quote,/from\('promotions'\)/)
 assert.match(quote,/eq\('renewal_eligible',true\)/)
 assert.match(quote,/cairoToday\(\)/)
})
test('member mutations are ownership-scoped and never create subscriptions',()=>{
 assert.match(member,/getUser\(\)/)
 assert.match(member,/eq\('member_id',actor\)/)
 assert.match(member,/eq\('version',version\)/)
 assert.doesNotMatch(member,/from\('subscriptions'\)\.insert/)
 assert.doesNotMatch(member,/fetch\('\/api\/subscriptions\/renew'/)
})
test('only Super Admin can approve and completion links an existing verified membership',()=>{
 assert.match(admin,/role!=='super_admin'/)
 assert.match(admin,/status!=='ready_to_renew'/)
 assert.match(admin,/completed_subscription_id:subscriptionId/)
 assert.match(admin,/NO_ELIGIBLE_SUBSCRIPTION/)
 assert.match(admin,/eligibleForRenewalFulfillment/)
 assert.doesNotMatch(admin,/from\('subscriptions'\)\.insert/)
})
test('receipts are private, ownership checked and never count as posted payments',()=>{
 assert.match(proof,/r.member_id!==user.id/)
 assert.match(proof,/createSignedUrl/)
 assert.match(proof,/file.size>10485760/)
 assert.doesNotMatch(proof,/from\('subscription_payments'\)\.insert/)
})
test('new tables are RLS-enabled, server-only and audit triggers are present',()=>{
 for(const table of ['membership_renewal_requests','membership_renewal_events','membership_renewal_proofs']){
  assert.ok(sql.includes('alter table public.'+table+' enable row level security;'))
  assert.ok(sql.includes('revoke all on public.'+table+' from anon, authenticated;'))
 }
 assert.match(sql,/renewal_log_change after insert or update/)
 assert.match(sql,/renewal_event_immutable before update or delete/)
 assert.match(sql,/membership-renewal-proofs','membership-renewal-proofs',false/)
})
test('member status view has WhatsApp support and attached receipt',()=>{
 assert.match(ui,/https:\/\/wa.me\//)
 assert.match(ui,/Upload receipt/)
 assert.match(ui,/Receipt uploaded for manual verification/)
})

test('manual fulfillment is selected from server-verified eligible subscriptions, not a typed UUID',()=>{
 assert.match(admin,/eligibleRenewalSubscriptions/)
 assert.match(admin,/NO_ELIGIBLE_SUBSCRIPTION/)
 assert.match(admin,/completed_subscription_id:subscriptionId/)
 const uiAdmin=read('src/components/admin/AdminMembershipRenewals.tsx')
 assert.match(uiAdmin,/Refresh eligible renewals/)
 assert.match(uiAdmin,/Newly created subscription/)
 assert.match(uiAdmin,/Confirm manual renewal and complete/)
 assert.doesNotMatch(uiAdmin,/Renewed subscription UUID/)
})

test('financial fulfillment checks ledger totals and zero outstanding dues without posting payments',()=>{
 assert.match(admin,/from\('subscription_payments'\)\.select\('subscription_id,amount,member_id'\)/)
 assert.match(admin,/ledgerCounts\.get\(x\.id\)/)
 assert.match(admin,/ledgerAmounts\.get\(x\.id\)/)
 assert.doesNotMatch(admin,/from\('subscription_payments'\)\.insert/)
})

test('fulfillment eligibility: paid, due, source dates, reuse, member and pricing guards',()=>{
 const ts=require('typescript')
 const {runInNewContext}=require('node:vm')
 const source=read('src/lib/renewalFulfillmentEligibility.ts')
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
 const exports={}
 runInNewContext(compiled,{exports})
 const eligible=exports.eligibleForRenewalFulfillment
 assert.equal(typeof eligible,'function')
 const base={
  request:{member_id:'member-A',plan:'3m',source_subscription_id:'old-sub',
   created_at:'2026-11-19T06:00:00Z',approved_price_egp:5250,payment_verified_amount_egp:5250},
  candidate:{id:'new-sub',member_id:'member-A',plan:'3m',status:'active',
   created_at:'2026-11-19T07:00:00Z',start_date:'2026-12-03',amount:5250,amount_due:0},
  source:{status:'active',end_date:'2026-12-02'},alreadyLinked:false,
  ledgerAmount:5250,ledgerCount:1
 }
 assert.equal(eligible(base),true,'properly posted renewal is eligible')
 assert.equal(eligible({...base,ledgerCount:0,ledgerAmount:0}),false,'a receipt is not a ledger payment')
 assert.equal(eligible({...base,ledgerAmount:5251}),false,'mismatched ledger sum')
 assert.equal(eligible({...base,candidate:{...base.candidate,amount_due:100,amount:5150}}),false,'outstanding dues')
 assert.equal(eligible({...base,candidate:{...base.candidate,member_id:'member-B'}}),false,'another member')
 assert.equal(eligible({...base,candidate:{...base.candidate,plan:'6m'}}),false,'different plan')
 assert.equal(eligible({...base,candidate:{...base.candidate,start_date:'2026-12-02'}}),false,'overlap with source')
 assert.equal(eligible({...base,alreadyLinked:true}),false,'previously linked')
 assert.equal(eligible({...base,candidate:{...base.candidate,id:'old-sub'}}),false,'source subscription')
 assert.equal(eligible({...base,candidate:{...base.candidate,created_at:'2026-11-18T07:00:00Z'}}),false,'old subscription')
 assert.equal(eligible({...base,request:{...base.request,payment_verified_amount_egp:null}}),false,'payment not verified')
 assert.equal(eligible({...base,candidate:{...base.candidate,amount:0},request:{...base.request,approved_price_egp:0,payment_verified_amount_egp:0},ledgerAmount:0,ledgerCount:0}),true,'fully discounted approved renewal')
})

test('staging-only dry-run refuses production and only reads requests',()=>{
 const dry=read('src/app/api/admin/membership-renewal-requests/dry-run/route.ts')
 const uiAdmin=read('src/components/admin/AdminMembershipRenewals.tsx')
 assert.match(dry,/target!=='staging'/)
 assert.match(dry,/profile\?\.role!=='super_admin'/)
 assert.match(dry,/eligibleForRenewalFulfillment/)
 assert.match(dry,/persisted_changes:0/)
 assert.doesNotMatch(dry,/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/)
 assert.match(uiAdmin,/Run safe completion simulation/)
 assert.match(uiAdmin,/This is not a real completion/)
 assert.match(uiAdmin,/Staging only/)
})
