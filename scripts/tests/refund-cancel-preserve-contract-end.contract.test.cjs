const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')

const component=fs.readFileSync('src/components/members/MembershipRefundSubscriptionImpactActions.tsx','utf8')
const migration=fs.readFileSync('supabase/migrations/20261118220000_refund_cancel_preserve_contract_end.sql','utf8')

test('paid refund cancellation preserves the contractual subscription end date',()=>{
  assert.match(
    migration,
    /if p_action = 'cancel_subscription' then[\s\S]*v_next_status := 'cancelled';[\s\S]*v_next_end := s\.end_date;/
  )
  assert.doesNotMatch(migration,/v_next_end := least\(s\.end_date, v_today\)/)
  assert.match(migration,/update public\.subscriptions[\s\S]*set status = v_next_status, end_date = v_next_end/)
})

test('refund impact UI explains that cancellation does not rewrite plan duration',()=>{
  assert.match(component,/Contract end date \(unchanged\)/)
  assert.match(component,/contractual start\/end dates stay unchanged/)
  assert.match(component,/access ends through the cancelled status/)
  assert.match(
    component,
    /function cancellationEndDate\(subscription: Props\['subscription'\]\) \{[\s\S]*return normalizeDateOnly\(subscription\?\.end_date\)/
  )
})
