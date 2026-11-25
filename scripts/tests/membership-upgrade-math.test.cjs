const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const vm=require('node:vm')
const ts=require('typescript')
const file=fs.readFileSync('src/lib/membershipUpgradeMath.ts','utf8')
const moduleRecord={exports:{}}
const compiled=ts.transpileModule(file,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText
vm.runInNewContext(compiled,{module:moduleRecord,exports:moduleRecord.exports})
const {daysInclusive,isHigherPlan,isUpgradePlan,quoteUpgrade}=moduleRecord.exports

test('plans permit only increases',()=>{
 assert.equal(isHigherPlan('1m','3m'),true)
 assert.equal(isHigherPlan('6m','3m'),false)
 assert.equal(isHigherPlan('1m','1m'),false)
 assert.equal(isUpgradePlan('sessions'),false)
})

test('November 30-day subscription with 10 days remaining credits EGP 733.33',()=>{
 const quote=quoteUpgrade({startDate:'2026-11-01',endDate:'2026-11-30',effectiveDate:'2026-11-21',capturedPaidEGP:2200,targetPriceEGP:5250})
 assert.equal(quote.totalDays,30)
 assert.equal(quote.daysRemaining,10)
 assert.equal(quote.creditEGP,733.33)
 assert.equal(quote.paymentDueEGP,4516.67)
 assert.equal(quote.effectiveDate,'2026-11-21')
})

test('the end date is inclusive; leap-day and month-end dates count precisely',()=>{
 assert.equal(daysInclusive('2028-02-01','2028-02-29'),29)
 const quote=quoteUpgrade({startDate:'2028-02-01',endDate:'2028-02-29',effectiveDate:'2028-02-29',capturedPaidEGP:2900,targetPriceEGP:5250})
 assert.equal(quote.daysRemaining,1)
 assert.equal(quote.creditEGP,100)
})

test('cannot quote expired, pre-start, malformed, negative or over-credit upgrades',()=>{
 const input={startDate:'2026-11-01',endDate:'2026-11-30',effectiveDate:'2026-12-01',capturedPaidEGP:2200,targetPriceEGP:5250}
 assert.throws(()=>quoteUpgrade(input),/SUBSCRIPTION_NOT_CURRENT/)
 assert.throws(()=>quoteUpgrade({...input,effectiveDate:'2026-10-31'}),/SUBSCRIPTION_NOT_CURRENT/)
 assert.throws(()=>quoteUpgrade({...input,effectiveDate:'2026-11-21',startDate:'2026-02-30'}),/INVALID_DATE/)
 assert.throws(()=>quoteUpgrade({...input,effectiveDate:'2026-11-21',capturedPaidEGP:-1}),/INVALID_AMOUNT/)
 assert.throws(()=>quoteUpgrade({...input,effectiveDate:'2026-11-01',capturedPaidEGP:10000}),/CREDIT_EXCEEDS_TARGET_PRICE/)
})

test('preview math cannot directly mutate finance ledgers',()=>{
 assert.doesNotMatch(file,/\.from\(|\.insert\(|\.update\(/)
})

test('historical payment date is separate from effective date and quote route is Super Admin only',()=>{
 const api=fs.readFileSync('src/app/api/admin/membership-upgrades/quote/route.ts','utf8')
 assert.match(api,/payment_date/)
 assert.match(api,/effectiveDate=cairoToday\(\)/)
 assert.match(api,/quoteUpgrade\(/)
 assert.match(api,/actor\?\.role !== 'super_admin'/)
 assert.doesNotMatch(api,/\.insert\(|\.update\(|\.delete\(/)
})

test('15% membership offer applies to target price without discounting the existing credit again',()=>{
 const base=8100
 const discounted=Number((base*0.85).toFixed(2))
 const quote=quoteUpgrade({
  startDate:'2026-11-07',endDate:'2027-02-07',effectiveDate:'2026-11-25',
  capturedPaidEGP:5250,targetPriceEGP:discounted,
 })
 assert.equal(quote.totalDays,93)
 assert.equal(quote.daysRemaining,75)
 assert.equal(quote.creditEGP,4233.87)
 assert.equal(quote.targetPriceEGP,6885)
 assert.equal(quote.paymentDueEGP,2651.13)
})

test('upgrade quote and apply use the same authoritative promotion pricing rule',()=>{
 const quoteRoute=fs.readFileSync('src/app/api/admin/membership-upgrades/quote/route.ts','utf8')
 const migration=fs.readFileSync('supabase/migrations/20261125074500_membership_upgrade_active_promotions.sql','utf8')
 const invoice=fs.readFileSync('src/lib/membershipUpgradeInvoice.ts','utf8')
 assert.match(quoteRoute,/rpc\('membership_upgrade_promotion_price_v1'/)
 assert.match(migration,/membership_upgrade_promotion_price_v1\(p_to_plan,v_today,v_base_price\)/)
 assert.match(migration,/target_list_price_egp,promotion_id,promotion_discount_egp/)
 assert.match(migration,/QUOTE_STALE_RECALCULATE/)
 assert.match(invoice,/promotion_discount_egp/)
})
