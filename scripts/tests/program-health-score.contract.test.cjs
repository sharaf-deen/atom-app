const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const ts=require('typescript')
const Module=require('node:module')

const source=fs.readFileSync('src/lib/programHealthScore.ts','utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const imported=new Module('/tmp/programHealthScore.cjs',module)
imported.filename='/tmp/programHealthScore.cjs'
imported.paths=module.paths
imported._compile(compiled,imported.filename)
const {scoreProgram,priorityActions}=imported.exports
const sql=fs.readFileSync('supabase/migrations/20261116110000_program_health_score_signals.sql','utf8')
const ui=fs.readFileSync('src/app/admin/program-health/ProgramHealthDashboard.tsx','utf8')
const page=fs.readFileSync('src/app/admin/program-health/page.tsx','utf8')
const sample={key:'adults-beginners',joined_30:12,joined_previous_30:6,ended_30:2,ended_previous_30:1,expiring_7:3,expiring_30:5,renewal_members:[]}

test('Missing data produces N/A, not a fabricated 0 or 100',()=>{
 const p=scoreProgram({enrolled:12,active:9,target_capacity:null},undefined)
 assert.equal(p.score,null)
 assert.equal(p.coverage,40)
 assert.equal(p.factors.find(x=>x.name==='Per-class attendance').score,null)
 assert.equal(p.factors.find(x=>x.name==='Per-class attendance').weight,0)
})
test('Score is bounded, interpretable, and considers active capacity not total enrollments',()=>{
 const p=scoreProgram({enrolled:40,active:15,target_capacity:20},sample)
 const higher=scoreProgram({enrolled:40,active:20,target_capacity:20},sample)
 assert.ok(p.score>=0&&p.score<=100)
 assert.ok(higher.factors[0].score>p.factors[0].score)
 assert.equal(p.coverage,100)
 assert.equal(p.factors[0].score,94)
 const crowded=scoreProgram({enrolled:40,active:30,target_capacity:20},sample)
 assert.ok(crowded.factors[0].score<higher.factors[0].score)
})
test('Subscription renewal risk lowers retention; momentum reacts to period trend',()=>{
 const input={enrolled:20,active:15,target_capacity:20}
 const baseline=scoreProgram(input,{...sample,expiring_7:0})
 const risk=scoreProgram(input,sample)
 assert.ok(baseline.factors[1].score>risk.factors[1].score)
 assert.ok(risk.trend>0)
 const decline=scoreProgram(input,{...sample,joined_30:1,joined_previous_30:15,ended_30:2,ended_previous_30:0})
 assert.ok(decline.factors[2].score<risk.factors[2].score)
 assert.ok(decline.trend<0)
})
test('Actions prioritize renewals and label gym-wide scan limitations',()=>{
 const actions=priorityActions({enrolled:20,active:15,target_capacity:20},sample,'watch',7)
 assert.ok(actions.some(x=>x.includes('seven days')))
 assert.ok(actions.some(x=>x.includes('gym-wide scan')))
 assert.ok(actions.length<=5)
})
test('Signals RPC is Super Admin restricted and read-only; UI labels uncertainty',()=>{
 assert.match(sql,/SUPER_ADMIN_REQUIRED/)
 assert.match(sql,/revoke all on function public\.atom_program_health_signals\(uuid\) from public,anon,authenticated/)
 assert.match(sql,/grant execute on function public\.atom_program_health_signals\(uuid\) to service_role/)
 assert.match(sql,/status='active'/)
 assert.match(sql,/max\(s\.end_date\)/)
 assert.match(sql,/joined_previous_30/)
 assert.doesNotMatch(sql,/update public\.|delete from public\.|insert into public\./)
 assert.match(page,/me\.role!=='super_admin'/)
 assert.match(page,/atom_program_health_signals/)
 assert.match(ui,/Program Health Score/)
 assert.match(ui,/measurable coverage/)
 assert.match(ui,/Priority actions/)
 assert.match(ui,/Renewal risk/)
 assert.match(ui,/gym-wide scan/)
})
