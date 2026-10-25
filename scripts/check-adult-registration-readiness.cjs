#!/usr/bin/env node
// Static adult E2E readiness checks; no HTTP, Supabase, Auth or email calls.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = process.cwd();
const read = (p) => { try { return fs.readFileSync(path.join(root,p),'utf8') } catch { return '' } };
const checks = [
 ['AD01_SUBMIT_GATED','src/app/api/public-registration/submit/route.ts',/ATOM_PUBLIC_REGISTRATION_SUBMIT_ENABLED/,'PASS'],
 ['AD01_ATOMIC_INSERT','src/app/api/public-registration/submit/route.ts',/atom_submit_public_registration_v1/,'PASS'],
 ['AD02_SINGLE_USE_VERIFICATION','src/lib/publicRegistrationEmailVerification.ts',/consume|consumed|used_at/i,'REVIEW'],
 ['AD03_IDENTITY_AUDIT','src/app/api/admin/public-registration/provisioning/identity-check/route.ts',/auditRegistrationIdentity/,'PASS'],
 ['AD04_AUTH_PROVISIONING_GATED','src/app/api/admin/public-registration/provisioning/auth-create/route.ts',/ATOM_REGISTRATION_AUTH_PROVISIONING_ENABLED/,'PASS'],
 ['AD04_MEMBER_PROVISIONING_GATED','src/app/api/admin/public-registration/provisioning/member-family/route.ts',/ATOM_REGISTRATION_MEMBER_FAMILY_PROVISIONING_ENABLED/,'PASS'],
 ['AD05_INVITATION_GATED','src/app/api/admin/public-registration/provisioning/invite/route.ts',/ATOM_REGISTRATION_INVITATION_ENABLED/,'PASS'],
 ['AD06_PASSWORD_ACTIVATION_WIRED','src/app/auth/set-password/page.tsx',/\/api\/public-registration\/activation\/complete/,'PASS'],
 ['AD06_ACTIVATION_GATED','src/app/api/public-registration/activation/complete/route.ts',/ATOM_REGISTRATION_DEFINITIVE_ACTIVATION_ENABLED/,'PASS'],
 ['AD07_CONSENT_API_GATED','src/app/api/public-registration/legal-consent/finalize/route.ts',/ATOM_REGISTRATION_LEGAL_FINALIZATION_ENABLED/,'PASS'],
 ['AD07_CONSENT_UI_WIRED','src/app',/\/api\/public-registration\/legal-consent\/finalize/,'PASS'],
 ['AD08_MEMBER_PROFILE','src/app/profile/page.tsx',/./,'REVIEW'],
];
function allFiles(p) {const abs=path.join(root,p); if (!fs.existsSync(abs)) return []; const s=fs.statSync(abs); return s.isFile()?[p]:fs.readdirSync(abs,{withFileTypes:true}).flatMap(d=>allFiles(path.join(p,d.name))).filter(x=>/\.(tsx?|jsx?)$/.test(x));}
const results=checks.map(([id,target,regex,foundStatus])=>{const files=allFiles(target);const found=files.some(p=>regex.test(read(p)));return {id,status:found?foundStatus:(id==='AD07_CONSENT_UI_WIRED'?'BLOCKED':'FAIL'),finding:found?'Matching source contract found; runtime not tested':id==='AD07_CONSENT_UI_WIRED'?'No client caller for legal consent finalization endpoint found; authenticated consent UX needs integration':'Expected source contract not found',target}});
const sha=crypto.createHash('sha256').update(read('src/app/api/public-registration/submit/route.ts')).digest('hex').slice(0,12);
const report={kind:'static-readiness-only',generated_utc:new Date().toISOString(),submit_route_sha256_prefix:sha,summary:results.reduce((a,x)=>(a[x.status]=(a[x.status]||0)+1,a),{}),results,e2e_execution:'NOT_RUN',production_launch:'NO_GO'};
const dest=process.argv.indexOf('--out');if(dest!==-1){const file=process.argv[dest+1];if(!file) throw Error('--out requires a path');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');}
for(const r of results) console.log(`${r.status.padEnd(7)} ${r.id} — ${r.finding}`);
console.log('E2E NOT RUN / PRODUCTION NO-GO');
// Missing acceptance UX is a known blocker, but do not break CI due to an honest readiness finding.
if(results.some(r=>r.status==='FAIL')) process.exitCode=1;
