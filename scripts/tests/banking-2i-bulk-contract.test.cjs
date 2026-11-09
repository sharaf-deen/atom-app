const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const source = path => readFileSync(path, 'utf8')

test('Banking 2I income and outflow bulk endpoints require Super Admin and explicit verification', () => {
  for (const path of [
    'src/app/api/admin/banking/outflows/bulk/route.ts',
    'src/app/api/admin/banking/reconciliation/bulk-v2/route.ts',
  ]) {
    const text = source(path)
    assert.match(text, /me\.role !== 'super_admin'/)
    assert.match(text, /body\.verified !== true/)
    assert.match(text, /pairs\.length > 50/)
    assert.match(text, /new Set<string>\(\)/)
    assert.match(text, /createSupabaseAdminClient\(\)\.rpc/)
  }
})
test('Banking 2I SQL locks match tables, confirms funds and denies public execution', () => {
  for (const [path, table] of [
    ['supabase/migrations/20261109100000_banking_2i_atomic_outflow_bulk.sql', 'bank_outflow_matches'],
    ['supabase/migrations/20261109101000_banking_2i_atomic_income_bulk.sql', 'bank_payment_matches'],
  ]) {
    const sql = source(path)
    assert.match(sql, new RegExp('lock table public\\.' + table))
    assert.match(sql, /p_verified is distinct from true/)
    assert.match(sql, /revoke all on function/)
    assert.match(sql, /grant execute on function/)
    assert.match(sql, /to service_role/)
    assert.match(sql, /raise exception 'ALREADY_PARTIALLY_MATCHED'/)
  }
})
test('Banking 2I board never performs automatic writes', () => {
  const text = source('src/components/admin/banking/BankUnifiedReviewBoard.tsx')
  assert.match(text, /onClick=\{\(\) => void confirmBulk\(\)\}/)
  assert.match(text, /!verified/)
  assert.match(text, /reason\.trim\(\)\.length < 10/)
  assert.match(text, /bank_transaction_id/)
  assert.doesNotMatch(text, /useEffect\(/)
})
