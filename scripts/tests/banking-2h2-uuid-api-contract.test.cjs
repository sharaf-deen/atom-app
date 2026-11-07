const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const route = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src/app/api/admin/banking/reconciliation/bulk/route.ts'),
  'utf8'
)
const line = route.match(/^const UUID = \/(.*)\/i$/m)
assert.ok(line, 'The production bulk route must declare its UUID validator')
const validate = new RegExp(line[1], 'i')

test('Banking 2H.2: representative valid bank credits and validation batch UUIDs are accepted', () => {
  const validIds = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-9222-222222222222',
    '33333333-3333-4333-a333-333333333333',
    '44444444-4444-4444-b444-444444444444',
    '55555555-5555-4555-8555-555555555555',
    '66666666-6666-4666-a666-666666666666',
  ]
  for (const id of validIds) assert.equal(validate.test(id), true, id)
})

test('Banking 2H.2: rejects malformed UUIDs and demo placeholders', () => {
  for (const bad of [
    'demo-batch-unique',
    'acf9d12e-ce3b-4a7d-ab19-1cd7efb1635',
    '55555555-5555-4555-8555-555555555555zzz',
    'acf9d12e-ce3b-4a7d-zb19-1cd7efb1635d',
    'acf9d12ece3b4a7dab191cd7efb1635d',
  ]) assert.equal(validate.test(bad), false, bad)
})
