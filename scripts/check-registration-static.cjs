#!/usr/bin/env node
// Read-only, dependency-free source contract inspection. NOT an end-to-end test.
const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd();
const results = [];
function check(id, rel, patterns, note) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) { results.push({id, result:'FAIL', detail:`Missing ${rel}`}); return; }
  const source = fs.readFileSync(file, 'utf8');
  const missing = patterns.filter(p => !p.test(source)).map(String);
  results.push({id, result: missing.length ? 'FAIL' : 'PASS', detail: missing.length ? `Missing source pattern: ${missing.join(', ')}` : note});
}
check('REG-01','src/app/register/page.tsx', [/ATOM_PUBLIC_REGISTRATION_SUBMIT_ENABLED/,/PublicRegistrationForm/,/robots:/], 'Page feature flag and noindex present');
check('REG-02','src/components/public-registration/PublicRegistrationForm.tsx',[/submitEnabled/,/signerConfirmed/,/\/api\/public-registration\/submit/], 'Form has guarded submit path and signer confirmation');
check('REG-03','src/app/api/public-registration/submit/route.ts',[/ATOM_PUBLIC_REGISTRATION_SUBMIT_ENABLED/,/ATOM_REGISTRATION_RATE_LIMIT_SECRET/,/atom_submit_public_registration_v1/,/status: 202/], 'Submission route has feature flag, rate limit secret and RPC');
check('REG-04','src/app/api/public-registration/verification/confirm/route.ts',[/export async function POST/], 'Email verification confirmation endpoint exists');
check('REG-05','src/lib/publicRegistrationOrchestrationPlan.ts',[/RECONCILE_AUTH/,/RECONCILE_INVITATION/,/CHECK_LEGAL_CONSENT/,/BLOCKED_REQUIRES_REVIEW/,/readyForAutomaticExecution: false/], 'Orchestration plans are not automatic authorizations');
check('REG-06','src/app/api/admin/public-registration/provisioning/transition/route.ts',[/ATOM_REGISTRATION_SAFE_TRANSITIONS_ENABLED/,/super_admin/,/RECONCILE_AUTH/,/COMPLETE_MEMBER_FAMILY/], 'Guarded Super Admin transitions present');
check('REG-07','src/app/api/public-registration/activation/complete/route.ts',[/ATOM_REGISTRATION_DEFINITIVE_ACTIVATION_ENABLED/], 'Activation feature flag present');
check('REG-08','src/app/api/public-registration/legal-consent/finalize/route.ts',[/ATOM_REGISTRATION_LEGAL_FINALIZATION_ENABLED/,/getMemberLegalCompliance/,/recordMemberLegalAcceptances/,/auth\.getUser/], 'Authenticated legal acceptance endpoint present');
check('REG-09','src/app/reception/registrations/page.tsx',[/RegistrationDeskClient/], 'Reception desk page present');
check('REG-10','src/app/reception/registrations/RegistrationAdminActions.tsx',[/provisioning\/plan/], 'Super Admin orchestration panel wired');
check('REG-11','src/app/auth/set-password/page.tsx',[/password/], 'Password setup page present');
check('REG-12','src/app/api/admin/public-registration/invitation/resend/route.ts',[/ATOM_REGISTRATION_INVITATION_RESEND_ENABLED/], 'Resend feature flag present');
console.log('ATOM Public Registration — source contract inspection (READ ONLY; NOT E2E)');
console.table(results);
const out = { kind:'STATIC_SOURCE_CONTRACT_ONLY', checked_at:new Date().toISOString(), summary:{pass:results.filter(x=>x.result==='PASS').length,fail:results.filter(x=>x.result==='FAIL').length},results };
if (process.argv.includes('--json')) fs.writeFileSync(path.join(root,'registration-static-results.json'),JSON.stringify(out,null,2));
process.exitCode = out.summary.fail ? 1 : 0;
