#!/usr/bin/env node
'use strict'
// Read-only runner: no HTTP, no database access, no email; the human supplies evidence.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const args = process.argv.slice(2);
const opt = (key) => { const i=args.indexOf(key); return i>=0 ? args[i+1] : undefined; };
const repo = process.cwd();
const sourceChecks = [
 ['A01','src/app/api/public-registration/submit/route.ts',['ATOM_PUBLIC_REGISTRATION_SUBMIT_ENABLED','atom_submit_public_registration_v1']],
 ['A02','src/app/api/public-registration/verification/confirm/route.ts',['POST']],
 ['A03','src/app/api/admin/public-registration/provisioning/identity-check/route.ts',['auditRegistrationIdentity']],
 ['A04','src/app/api/admin/public-registration/provisioning/member-family/route.ts',['ATOM_REGISTRATION_MEMBER_FAMILY_PROVISIONING_ENABLED']],
 ['A05','src/app/api/admin/public-registration/provisioning/invite/route.ts',['ATOM_REGISTRATION_INVITATION_ENABLED']],
 ['A06','src/app/api/public-registration/activation/complete/route.ts',['ATOM_REGISTRATION_DEFINITIVE_ACTIVATION_ENABLED']],
 ['A07','src/app/auth/registration-consent/page.tsx',['/api/public-registration/legal-consent/finalize','accepted_document_version_ids']],
 ['A08','src/app/auth/registration-consent/page.tsx',['router.replace(destination)']],
 ['A09','src/app/api/public-registration/submit/route.ts',['atom_submit_public_registration_v1']],
 ['A10','src/app/api/admin/public-registration/invitation/resend/route.ts',['POST']],
 ['A11','src/app/api/admin/public-registration/provisioning/auth-reconcile/route.ts',['POST']],
 ['A12','src/app/api/admin/public-registration/provisioning/transition/route.ts',['POST']],
 ];
let failed=0;
for (const [id,relative,tokens] of sourceChecks){
  const full=path.join(repo,relative);
  const data=fs.existsSync(full)?fs.readFileSync(full,'utf8'):'';
  const missing=tokens.filter(t=>!data.includes(t));
  if(missing.length){ failed++; console.log(`FAIL ${id}: ${relative} (${missing.join(', ')})`); }
  else console.log(`SOURCE ONLY ${id}: present (E2E NOT RUN)`);
}
const manifestFile=opt('--manifest');
if(!manifestFile){
 console.log('\nNO E2E EXECUTED. Provide --manifest <path> for a local isolation attestation check.');
 process.exitCode=failed?1:0;
} else {
 let m;
 try {m=JSON.parse(fs.readFileSync(path.resolve(manifestFile),'utf8'));} catch(e){console.error('Invalid or missing manifest:',e.message);process.exit(2);}
 const isHttps = s => {try {const u=new URL(s);return u.protocol==='https:' && !u.username && !u.password && !u.hash;}catch{return false;}};
 const required = ['previewUrl','productionUrl','testSupabaseProjectRef','productionSupabaseProjectRef','previewDeploymentSha','testEnvironmentConfirmed','previewEnvReviewed','productionFlagsRemainOff','testEmailControlled','testStaffIdentitiesConfirmed','migrationsVerifiedOnTest','emailProviderTestModeVerified','cleanUpPlanApproved'];
 let problems=required.filter(k=>!m[k]);
 if(!isHttps(m.previewUrl)||!isHttps(m.productionUrl))problems.push('https URLs');
 if(m.previewUrl===m.productionUrl)problems.push('preview and production URL are equal');
 if(m.testSupabaseProjectRef===m.productionSupabaseProjectRef)problems.push('Supabase refs are equal');
 for(const k of ['testSupabaseProjectRef','productionSupabaseProjectRef'])if(!/^[a-z0-9]{20}$/.test(m[k]||''))problems.push(`${k}: must be a 20-character Supabase project ref`);
 if(!/^[0-9a-f]{7,40}$/i.test(m.previewDeploymentSha||''))problems.push('invalid deployment SHA');
 const statuses = ['A01','A02','A03','A04','A05','A06','A07','A08','A09','A10','A11','A12'];
 if(m.evidence){
  for(const id of statuses){ const x=m.evidence[id];if(!x || !['NOT_RUN','PASS','FAIL','BLOCKED'].includes(x.status))problems.push(`${id}: invalid status`);
   if(x?.status==='PASS' && (!x.evidenceRef || !x.observedAt || !x.tester)) problems.push(`${id}: PASS requires evidenceRef, observedAt, tester`);
  }
 }
 console.log(problems.length?'ISOLATION / EVIDENCE INCOMPLETE:':'MANIFEST STRUCTURALLY COMPLETE (SELF-ATTESTED; NOT INDEPENDENTLY VERIFIED)');
 for(const problem of problems) console.log(' - '+problem);
 console.log('No HTTP requests or database actions performed. Environment safety must be verified in Vercel/Supabase consoles.');
 if(problems.length)process.exitCode=2;
}
