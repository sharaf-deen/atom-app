const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const rbac = fs.readFileSync('src/lib/rbac.ts','utf8')
const home = fs.readFileSync('src/components/home/SuperAdminPages.tsx','utf8')
const menu = fs.readFileSync('src/components/RoleMenu.tsx','utf8')
const destination = fs.readFileSync('src/app/reception/registrations/page.tsx','utf8')

test('Registration Desk is linked by all three authorized role menus', () => {
  for (const role of ['reception','admin','super_admin']) {
    const start = rbac.indexOf('  '+role+': [')
    const end = rbac.indexOf('  ],', start)
    assert.ok(start >= 0 && end > start, role+' navigation exists')
    const section = rbac.slice(start,end)
    assert.match(section,/\{ label: 'Registrations', href: '\/reception\/registrations', icon: 'id' \}/)
  }
})
test('Super Admin Home includes direct Registration Desk navigation', () => {
  assert.match(home,/\{ href: '\/reception\/registrations', label: 'Reception Registrations' \}/)
})
test('Registration Desk menu grouping is consistent with reception operations', () => {
  assert.ok(menu.includes("href === '/reception/registrations'"))
  assert.match(destination,/canAccessReceptionDesk\(me.role\)/)
  assert.match(destination,/allowed="reception, admin, super_admin"/)
})
