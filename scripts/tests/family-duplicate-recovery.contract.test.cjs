const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const read = (path) => fs.readFileSync(path, 'utf8')

const migration = read('supabase/migrations/20261113090000_family_duplicate_safe_recovery.sql')
const api = read('src/app/api/admin/families/duplicate-recovery/route.ts')
const ui = read('src/app/admin/members/families/recover/DuplicateRecoveryPanel.tsx')
const memberSearch = read('src/app/api/members/search/route.ts')
const familySearch = read('src/app/api/admin/families/member-search/route.ts')
const listing = read('src/app/admin/members/page.tsx')
const kiosk = read('src/app/api/kiosk/scan/route.ts')

test('IDs are preserved and never deleted, archive is audited and atomic', () => {
  assert.match(migration, /alter table public\.profiles add column if not exists archived_at/)
  assert.match(migration, /family_duplicate_recovery_audit/)
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /family_guardian_promote_to_member/)
  assert.doesNotMatch(migration, /delete from public\.profiles/i)
  assert.match(migration, /v_count<>2/)
  assert.match(migration, /PROFILE_HAS_DEPENDENCIES|v_blockers := v_blockers \|\| jsonb_build_array/)
})

test('no public or staff access to destructive recovery', () => {
  assert.match(migration, /revoke all on function public\.family_duplicate_recovery_execute/)
  assert.match(migration, /grant execute on function public\.family_duplicate_recovery_execute.*to service_role/)
  assert.match(api, /normalizeRole\(actor\?\.role\) !== 'super_admin'/)
  assert.match(api, /confirmed !== true/)
  assert.match(api, /reason\.length < 10/)
})

test('preview required by UI, active search and scan exclude archives', () => {
  assert.match(ui, /Preview recovery/)
  assert.match(ui, /Confirm guarded recovery/)
  assert.match(memberSearch, /is\('archived_at', null\)/)
  assert.match(familySearch, /is\('archived_at', null\)/)
  assert.match(listing, /is\('archived_at', null\)/)
  assert.match(kiosk, /if \(memberProfile\.archived_at\)/)
})
