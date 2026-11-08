const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const read=(p)=>fs.readFileSync(path.join(__dirname,'../..',p),'utf8')
const integrity=read('supabase/migrations/20261108124000_staff_payroll_coaching_assignment_import_integrity.sql')
const declarations=read('supabase/migrations/20261108125000_staff_payroll_monthly_coaching_declarations.sql')
const api=read('src/app/api/staff-payroll/coaching-declarations/route.ts')
test('Assignment synchronization changes only safe future programme-owned/default sessions',()=>{
  for(const expected of ['v_session_date >= ((now() at time zone \'Africa/Cairo\')::date)',
    "a.assignment_source not in ('program','schedule_default')",
    'staff_payroll_coaching_import_items','TEAM_RESYNCED','apply_training_program_team_to_session']) {
    assert.ok(integrity.includes(expected),expected)
  }
})
test('Canonical account used for payroll, teaching account kept for evidence',()=>{
 assert.ok(integrity.includes('v_payroll_staff_user_id'))
 assert.ok(integrity.includes('link.linked_user_id = v_staff_user_id'))
 assert.ok(integrity.includes('v_payroll_staff_user_id,\n        v_task.id'))
 assert.ok(integrity.includes('v_staff_user_id,\n      v_task.id')===false)
})
test('Monthly declarations are authenticated, RLS-protected and salary approval is outside the lot',()=>{
 for(const expected of ['ENABLE ROW LEVEL SECURITY',
  'REVOKE ALL ON public.staff_payroll_coaching_monthly_declarations FROM PUBLIC,anon,authenticated',
  "v_role IS DISTINCT FROM 'super_admin'",
  'MONTHLY_TASK_CONFLICT','STAFF_PAYROLL_MONTH_LOCKED',
  'staff_payroll_account_links','public.audit_logs','NO_ACTIVE_PAYROLL_STAFF_PROFILE'
 ]) assert.ok(declarations.includes(expected),expected)
 assert.ok(!declarations.includes('staff_payroll_approval_versions'))
 assert.ok(!declarations.includes('staff_payroll_salary_payments'))
 assert.ok(api.includes("action === 'submit'"))
 assert.ok(api.includes("action === 'review'"))
})
