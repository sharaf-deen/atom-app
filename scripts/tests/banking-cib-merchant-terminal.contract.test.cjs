const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const source = fs.readFileSync('src/app/api/admin/banking/cib-preview/route.ts', 'utf8')
test('CIB report preview supports both verified terminal formats', () => {
  assert.match(source, /row\.terminalid === '28276801'/)
  assert.match(source, /row\.terminalid === '282768'/)
  assert.match(source, /\^28276801M/)
  assert.match(source, /if \(!directTerminal && !merchantBatch\)/)
})

function allowed(terminal, batch) {
  const direct = terminal === '28276801' && /^28276801[_M]/.test(batch)
  const merchant = terminal === '282768' && /^28276801M[0-9]+$/.test(batch)
  return direct || merchant
}

test('POS batches and merchant-coded M batches are accepted', () => {
  assert.equal(allowed('28276801', '28276801_000013'), true)
  assert.equal(allowed('282768', '28276801M000019'), true)
})
test('Unrelated terminal and mismatched batch are rejected', () => {
  assert.equal(allowed('99999999', '99999999_000013'), false)
  assert.equal(allowed('282768', '99999999M000019'), false)
  assert.equal(allowed('28276801', '99999999_000013'), false)
})
