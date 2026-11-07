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

test('Banking 2H.2: actual October bank credits and validation batch UUIDs are accepted', () => {
  const validIds = [
    'a94b84d9-1681-4371-a25f-1f2e1228af68',
    'f12fe23d-e854-4273-9bf3-5efafe0beda2',
    '4cb20cbc-7f28-456f-ac47-1a2997786f2d',
    'e9ae9fe7-504c-4f60-a199-131efb9c1c50',
    'acf9d12e-ce3b-4a7d-ab19-1cd7efb1635d',
    'd78478b3-b12a-462f-a770-0b5d666b509a',
  ]
  for (const id of validIds) assert.equal(validate.test(id), true, id)
})

test('Banking 2H.2: rejects malformed UUIDs and demo placeholders', () => {
  for (const bad of [
    'demo-batch-unique',
    'acf9d12e-ce3b-4a7d-ab19-1cd7efb1635',
    'acf9d12e-ce3b-4a7d-ab19-1cd7efb1635dzzz',
    'acf9d12e-ce3b-4a7d-zb19-1cd7efb1635d',
    'acf9d12ece3b4a7dab191cd7efb1635d',
  ]) assert.equal(validate.test(bad), false, bad)
})
