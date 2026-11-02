#!/usr/bin/env node
/**
 * Security Hardening 1C.7 — authenticated HTTP regression in isolated LOCAL Supabase.
 *
 * HARD SAFETY GATE: requires ATOM_LOCAL_FINANCIAL_E2E=1 and validates both local
 * Supabase API URL and loopback Next host. NEVER run against Staging or Production.
 * Uses fake auth users, genuine @supabase/ssr cookie sessions, actual Next route
 * handlers, and synthetic subscriptions in the freshly reset local database.
 * No external email/invoice action is requested. Tests use explicit HTTP bodies.
 */
import assert from 'node:assert/strict'
import { execSync, spawn } from 'node:child_process'
import { randomUUID, randomBytes } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'

assert.equal(process.env.ATOM_LOCAL_FINANCIAL_E2E, '1', 'Explicit local-only opt-in is required')
const parsed = Object.fromEntries(
  execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] })
    .split(/\r?\n/)
    .map(line => line.match(/^([A-Z_]+)=(.*)$/))
    .filter(Boolean)
    .map(match => [match[1], match[2].replace(/^["']|["']$/g, '')])
)
const api = parsed.API_URL || parsed.SUPABASE_URL || 'http://127.0.0.1:54321'
assert.match(api, /^http:\/\/(127\.0\.0\.1|localhost):54321\/?$/, 'Refusing nonlocal Supabase API')
const anon = parsed.ANON_KEY || parsed.PUBLISHABLE_KEY
const service = parsed.SERVICE_ROLE_KEY || parsed.SECRET_KEY
assert.ok(anon && service, 'Missing local Supabase API keys')
const admin = createClient(api, service, { auth:{persistSession:false,autoRefreshToken:false} })

const port = 31880
const origin = `http://127.0.0.1:${port}`
const ids = []
const subscriptions = []
const refundIds = []
let server
let tested = 0
const prefix = 'atom1c7-' + randomUUID().slice(0,8)
const password = 'Az9!' + randomBytes(14).toString('base64url')
const check = (label, actual, expected) => {
  assert.equal(actual,expected,`${label}: expected ${expected}, got ${actual}`)
  console.log(`PASS: ${label} = ${actual}`)
  tested++
}
async function signedCookie(email) {
  const jar = new Map()
  const client = createServerClient(api, anon, {
    cookies: {
      getAll: () => Array.from(jar, ([name,value]) => ({name,value})),
      setAll: items => { for (const item of items) {
        if ((item.options?.maxAge ?? 1) === 0) jar.delete(item.name)
        else jar.set(item.name,item.value)
      } },
    },
    auth: { autoRefreshToken:false, persistSession:true },
  })
  const {data,error} = await client.auth.signInWithPassword({email,password})
  if (error || !data.session) throw error || Error('No real auth session')
  return Array.from(jar,([name,value])=>`${name}=${encodeURIComponent(value)}`).join('; ')
}
async function createActor(role) {
  const email = `${prefix}-${role}@invalid.example`
  const {data,error} = await admin.auth.admin.createUser({email,password,email_confirm:true})
  if (error || !data.user?.id) throw error || Error('Failed to create fixture account')
  const id=data.user.id
  ids.push(id)
  const {error:profileError} = await admin.from('profiles').update({role}).eq('user_id',id)
  if(profileError)throw profileError
  const cookie = await signedCookie(email)
  if (!cookie) throw Error('Failed to create SSR session cookie')
  return {id,role,cookie}
}
async function post(actor,path,body) {
  const response=await fetch(origin+path,{
    method:'POST',
    headers:{'content-type':'application/json',cookie:actor.cookie},
    body:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(12000),
  })
  const text=await response.text()
  let json
  try {json=JSON.parse(text)} catch {throw Error(`Non-JSON response at ${path}: ${response.status} ${text.slice(0,200)}`)}
  return {status:response.status,body:json}
}
async function makeSubscription(member,amount,due){
  const {data,error}=await admin.from('subscriptions').insert({
    member_id:member.id,plan:'3m',subscription_type:'time',status:'active',
    start_date:new Date().toISOString().slice(0,10),
    end_date:'2027-02-01',amount,amount_due:due,payment_method:'cash',
  }).select('id').single()
  if(error)throw error
  subscriptions.push(data.id)
  return data.id
}
async function ready(){
  for(let i=0;i<70;i++){
    if(server.exitCode!==null)throw Error('Next local server exited unexpectedly')
    try{
      const r=await fetch(origin+'/api/subscriptions/delete',{signal:AbortSignal.timeout(800)})
      if(r.status===405 || r.status===401) return
    }catch{}
    await delay(750)
  }
  throw Error('Local Next server unavailable')
}
try {
  const actors={}
  for(const role of ['member','reception','admin','super_admin'])
    actors[role]=await createActor(role)
  const member=actors.member
  const funded=await makeSubscription(member,0,100)
  const empty=await makeSubscription(member,0,0)
  const startEnv={
    ...process.env, NODE_ENV:'development', PORT:String(port),
    NEXT_PUBLIC_SUPABASE_URL:api,NEXT_PUBLIC_SUPABASE_ANON_KEY:anon,
    SUPABASE_SERVICE_ROLE_KEY:service,ATOM_LOCAL_FINANCIAL_E2E:'1',
  }
  // The CI reset DB gives a local legacy service key. It is never printed.
  delete startEnv.SUPABASE_SECRET_KEY
  delete startEnv.RESEND_API_KEY
  server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','-H','127.0.0.1','-p',String(port)],{
    env:startEnv,stdio:['ignore','pipe','pipe'],
  })
  let tail=''
  for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>{tail=(tail+String(chunk)).slice(-1800)})
  await ready()

  let r=await post(member,'/api/subscriptions/delete',{id:empty})
  check('member delete forbidden',r.status,403)

  r=await post(actors.reception,'/api/subscriptions/delete',{id:empty})
  check('reception delete forbidden',r.status,403)

  r=await post(actors.admin,'/api/subscriptions/delete',{id:empty})
  check('admin delete forbidden',r.status,403)

  r=await post(actors.reception,'/api/subscriptions/update',{id:funded,patch:{amount_due:0}})
  check('reception update forbidden',r.status,403)

  r=await post(actors.admin,'/api/subscriptions/update',{id:funded,patch:{amount_due:0}})
  check('admin financial update forbidden',r.status,403)

  r=await post(actors.admin,'/api/membership-refunds/subscription-impact',{
    refund_id:randomUUID(), action:'keep_active',reason:'Local fake regression'
  })
  check('admin refund impact forbidden',r.status,403)

  r=await post(actors.reception,'/api/subscriptions/settle',{id:funded,amount_due:0})
  check('reception direct due adjustment forbidden',r.status,403)

  r=await post(actors.super_admin,'/api/subscriptions/settle',{
    id:funded,amount_paid:40,payment_method:'cash',invoice:{generate:false,email:false},
  })
  check('reception-style settlement by Super Admin',r.status,200)
  assert.equal(r.body.ok,true,'Settlement API result must report ok')
  const {data:after,error:afterError}=await admin.from('subscriptions')
    .select('amount,amount_due').eq('id',funded).single()
  if(afterError)throw afterError
  check('settlement paid amount',Number(after.amount),40)
  check('settlement remaining due',Number(after.amount_due),60)
  const {data:ledger,error:ledgerErr}=await admin.from('subscription_payments')
    .select('amount').eq('subscription_id',funded)
  if(ledgerErr)throw ledgerErr
  check('settlement ledger rows',ledger.length,1)
  check('settlement ledger paid sum',ledger.reduce((sum,p)=>sum+Number(p.amount),0),40)

  r=await post(actors.super_admin,'/api/subscriptions/delete',{id:funded})
  check('deletion of paid history forbidden',r.status,409)
  check('deletion failure code',r.body.error,'SUBSCRIPTION_HISTORY_PROTECTED')

  r=await post(actors.super_admin,'/api/subscriptions/delete',{id:empty})
  check('deletion of zero-history subscription allowed',r.status,200)
  check('deletion success',r.body.ok,true)

  // 1C.8 — genuine authenticated POST checks of creation/renewal guards.
  // These requests are intentionally rejected before touching financial data.
  r=await post(member,'/api/subscriptions/create',{
    memberId:member.id,plan:'1m',amount:100,payment_method:'cash',
    idempotency_key:randomUUID(),start_date:new Date().toISOString().slice(0,10),
  })
  check('member subscription create forbidden',r.status,403)
  r=await post(member,'/api/subscriptions/renew',{
    memberId:member.id,plan:'1m',amount:100,payment_method:'cash',
    idempotency_key:randomUUID(),
  })
  check('member subscription renewal forbidden',r.status,403)
  r=await post(actors.reception,'/api/subscriptions/create',{memberId:member.id,plan:'1m'})
  check('staff create requires idempotency key',r.status,400)
  check('staff create idempotency error',r.body.error,'IDEMPOTENCY_KEY_REQUIRED')
  r=await post(actors.admin,'/api/subscriptions/renew',{memberId:member.id,plan:'1m'})
  check('staff renew requires idempotency key',r.status,400)
  check('staff renew idempotency error',r.body.error,'IDEMPOTENCY_KEY_REQUIRED')

  // 1C.8 — successful HTTP subscription update, followed by freeze lifecycle.
  const freezeSub=await makeSubscription(member,0,0)
  r=await post(actors.admin,'/api/subscriptions/update',{
    id:freezeSub,patch:{end_date:'2027-02-15'},invoice:{generate:false,email:false}
  })
  check('admin subscription date update',r.status,200)
  const {data:edited,error:editError}=await admin.from('subscriptions')
    .select('end_date').eq('id',freezeSub).single()
  if(editError)throw editError
  check('updated subscription date',edited.end_date,'2027-02-15')

  const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10)
  const inFive=new Date(Date.now()+5*86400000).toISOString().slice(0,10)
  r=await post(actors.admin,'/api/subscriptions/freeze',{
    id:freezeSub,action:'create',from:tomorrow,to:inFive
  })
  check('admin freeze forbidden',r.status,403)
  r=await post(actors.super_admin,'/api/subscriptions/freeze',{
    id:freezeSub,action:'create',from:tomorrow,to:inFive
  })
  check('super admin freeze creation',r.status,200)
  check('super admin freeze result',r.body.ok,true)
  const {data:freezes,error:freezeError}=await admin.from('subscription_freezes')
    .select('id,days').eq('subscription_id',freezeSub).is('cleared_at',null)
  if(freezeError)throw freezeError
  check('active freeze count',freezes.length,1)
  check('inclusive freeze days',Number(freezes[0].days),5)
  r=await post(actors.super_admin,'/api/subscriptions/freeze',{
    id:freezeSub,action:'delete',freeze_id:freezes[0].id
  })
  check('super admin freeze cleared',r.status,200)
  const {count:clearedCount,error:clearedError}=await admin.from('subscription_freezes')
    .select('id',{count:'exact',head:true}).eq('subscription_id',freezeSub).is('cleared_at',null)
  if(clearedError)throw clearedError
  check('remaining active freezes',clearedCount,0)

  // 1C.8 — real HTTP refund-impact route using a synthetic already-paid refund.
  const refundSub=await makeSubscription(member,0,0)
  const {data:refund,error:refundError}=await admin.from('membership_refunds')
    .insert({member_id:member.id,subscription_id:refundSub,amount:1,
      refund_method:'cash',reason:'Local isolated regression',status:'paid'})
    .select('id').single()
  if(refundError)throw refundError
  refundIds.push(refund.id)
  r=await post(actors.admin,'/api/membership-refunds/subscription-impact',{
    refund_id:refund.id,action:'keep_active',reason:'Isolated role regression'
  })
  check('admin cannot apply real refund impact',r.status,403)
  r=await post(actors.super_admin,'/api/membership-refunds/subscription-impact',{
    refund_id:refund.id,action:'keep_active',reason:'Isolated keep-active regression'
  })
  check('super admin applies refund impact',r.status,200)
  check('refund impact response',r.body.ok,true)
  const {data:applied,error:appliedError}=await admin.from('membership_refunds')
    .select('subscription_impact_status,subscription_impact_action').eq('id',refund.id).single()
  if(appliedError)throw appliedError
  check('refund impact status persisted',applied.subscription_impact_status,'applied')
  check('refund impact action persisted',applied.subscription_impact_action,'keep_active')
  r=await post(actors.super_admin,'/api/membership-refunds/subscription-impact',{
    refund_id:refund.id,action:'keep_active',reason:'Duplicate impact rejection test'
  })
  check('refund duplicate application rejected',r.status,409)

  console.log(`PASS: ${tested} assertions with real local auth sessions and HTTP financial routes.`)
} catch(e){
  console.error('FAIL 1C.7:',e.message)
  process.exitCode=1
} finally {
  if(server){
    server.kill('SIGTERM')
    await delay(700)
    if(server.exitCode===null)server.kill('SIGKILL')
  }
  // Local-only disposable environment, cleanup even when checks fail.
  for(const id of refundIds){
    await admin.from('membership_refunds').delete().eq('id',id)
  }
  for(const id of subscriptions){
    // The protected-history trigger checks historical freezes as well as paid rows.
    await admin.from('subscription_freezes').delete().eq('subscription_id',id)
    const {data:payments}=await admin.from('subscription_payments').select('id').eq('subscription_id',id)
    if(payments?.length)await admin.from('subscription_payments').delete().eq('subscription_id',id)
    // Local test fixture only: deletion trigger forbids paid or due history.
    // Reset synthetic balances AFTER clearing ledger, then delete fixture.
    await admin.from('subscriptions').update({amount:0,amount_due:0}).eq('id',id)
    await admin.from('subscriptions').delete().eq('id',id)
  }
  for(const id of ids){
    await admin.auth.admin.deleteUser(id)
  }
}
