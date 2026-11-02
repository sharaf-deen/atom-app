#!/usr/bin/env node
// 1C.6 — execute REAL RBAC implementation, rather than copying logic into tests.
// This is a local CI permission-matrix test. No accounts, tokens, DB writes or HTTP calls.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

const source = readFileSync(resolve('src/lib/rbac.ts'), 'utf8')
const js = ts.transpileModule(source, {compilerOptions: {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext
}}).outputText
const rbac = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

const cases = [
  {role:'member', create:false, edit:false, finance:false, refund:false},
  {role:'coach', create:false, edit:false, finance:false, refund:false},
  {role:'reception', create:true, edit:false, finance:false, refund:false},
  {role:'admin', create:true, edit:true, finance:false, refund:false},
  {role:'super_admin', create:true, edit:true, finance:true, refund:true},
  {role:null, create:false, edit:false, finance:false, refund:false}
]

for (const c of cases) {
  test(`RBAC role ${c.role ?? '(none)'} — financial permissions`, () => {
    const role = c.role === null ? null : rbac.normalizeRole(c.role)
    assert.equal(rbac.canCreateSubscription(role), c.create, 'subscription create/renew/settle')
    assert.equal(rbac.canManageSubscriptions(role), c.edit, 'subscription edit')
    assert.equal(rbac.canManagePayments(role), c.finance, 'financial adjustments/deletion')
    assert.equal(rbac.canManageMembershipRefunds(role), c.refund, 'refund processing')
  })
}

test('Unknown roles fail closed', () => {
  const role = rbac.normalizeRole('pretend_super_admin')
  assert.equal(rbac.canManagePayments(role), false)
  assert.equal(rbac.canManageSubscriptions(role), false)
  assert.equal(rbac.canCreateSubscription(role), false)
})

test('Protected finance route gates reference shared RBAC', () => {
  const read = (p) => readFileSync(resolve(p), 'utf8')
  const paths = {
    create: 'src/app/api/subscriptions/create/route.ts',
    renew: 'src/app/api/subscriptions/renew/route.ts',
    settle: 'src/app/api/subscriptions/settle/route.ts',
    update: 'src/app/api/subscriptions/update/route.ts',
    delete: 'src/app/api/subscriptions/delete/route.ts',
    freeze: 'src/app/api/subscriptions/freeze/route.ts',
    refund: 'src/app/api/membership-refunds/subscription-impact/route.ts',
  }
  assert.match(read(paths.create), /!canCreateSubscription\(role\)/)
  assert.match(read(paths.renew), /!canCreateSubscription\(role\)/)
  assert.match(read(paths.settle), /canHandleDeskPayment\s*=\s*canCreateSubscription\(role\)/)
  assert.match(read(paths.settle), /canDirectlyAdjustDue\s*=\s*canManagePayments\(role\)/)
  assert.match(read(paths.update), /!canManageSubscriptions\(role\)/)
  assert.match(read(paths.update), /canManageFinancialFields\s*=\s*canManagePayments\(role\)/)
  assert.match(read(paths.delete), /!canManagePayments\(role\)/)
  assert.match(read(paths.freeze), /profile\?\.role\s*!==\s*'super_admin'/)
  assert.match(read(paths.refund), /role\s*!==\s*'super_admin'/)
})
