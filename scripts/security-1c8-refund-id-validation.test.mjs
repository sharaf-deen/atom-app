#!/usr/bin/env node
// Security 1C.8 regression: execute the actual refund-route UUID validation
// regular expression extracted from the route source, without an HTTP or DB call.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/app/api/membership-refunds/subscription-impact/route.ts','utf8')
const start = source.indexOf('function normalizeUuid(')
const end = source.indexOf('\n}',start)
assert.ok(start!==-1 && end>start,'normalizeUuid must exist')
const functionSource=source.slice(start,end)
const matched=functionSource.match(/return\s+(\/\^\[[^\n]+?\$\/i)\.test\(s\)/)
assert.ok(matched,'Unable to extract refund UUID regex')
const literal=matched[1]
const pattern=new RegExp(literal.slice(1,-2),'i')

test('refund route accepts standard five-group UUIDs',()=>{
  assert.equal(pattern.test('123e4567-e89b-42d3-a456-426614174000'),true)
  assert.equal(pattern.test('00000000-0000-0000-0000-000000000000'),true)
})
test('refund route rejects malformed or incomplete identifiers',()=>{
  assert.equal(pattern.test('123e4567-e89b-42d3-426614174000'),false)
  assert.equal(pattern.test('not-a-refund-id'),false)
  assert.equal(pattern.test('123e4567-e89b-42d3-a456-426614174000-suffix'),false)
})
