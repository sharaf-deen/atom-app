const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const home = fs.readFileSync('src/app/page.tsx', 'utf8')
const intakePage = fs.readFileSync('src/app/admin/members/family-intake/page.tsx', 'utf8')
const intakeManager = fs.readFileSync('src/components/members/FamilyIntakeManager.tsx', 'utf8')
const receptionBranch = home.slice(home.indexOf("  if (user.role === 'reception') {"),home.indexOf("  const displayName = await getDisplayName(user)"))
test('Reception home has exactly four links and no metrics or old widgets', () => {
  assert.ok(receptionBranch.startsWith("  if (user.role === 'reception')"))
  const actions = [...receptionBranch.matchAll(/\{ href: '([^']+)', label: '([^']+)'/g)].map(x => [x[1],x[2]])
  assert.deepEqual(actions, [
    ['/scan','SCAN ACCESS'],
    ['/kiosk','Créer un membre adulte'],
    ['/admin/members/family-intake?mode=member','Créer un membre enfant'],
    ['/members','Members'],
  ])
  assert.match(receptionBranch,/return \(/)
  assert.doesNotMatch(receptionBranch,/getOpsKpis|PriorityGrid|SummaryCard|HomeMemberLookup|HomeScanShortcut|QuickActions/)
})
test('Adult and child registration preserve their established access controlled forms', () => {
  assert.match(intakePage,/initialChildMode=\{memberMode \? 'member' : 'visitor'\}/)
  assert.match(intakeManager,/initialChildMode = 'visitor'/)
  assert.match(intakeManager,/newChild\(0, initialChildMode\)/)
  assert.match(intakePage,/canAccessFamilyIntake\(me.role\)/)
  assert.match(home,/if \(!user\)/)
})
