#!/usr/bin/env node
/**
 * Security Hardening 1C.5 — unauthenticated financial API HTTP checks.
 * Local CI only. Starts the built Next.js server on loopback, sends requests
 * with NO cookies, and asserts every privileged financial POST is rejected
 * before any operation can write to the database.
 *
 * This DOES NOT test authenticated financial writes or all role combinations.
 * It requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
 * (public client config). Do not pass service-role or secret keys to this test.
 */
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import assert from 'node:assert/strict'

const port = Number(process.env.ATOM_HTTP_TEST_PORT ?? '31879')
const origin = `http://127.0.0.1:${port}`
const fixtures = [
  ['/api/subscriptions/create', { member_id: '00000000-0000-4000-8000-000000000001', plan: '1m', amount: 100 }],
  ['/api/subscriptions/renew', { member_id: '00000000-0000-4000-8000-000000000001', plan: '1m', amount: 100 }],
  ['/api/subscriptions/settle', { id: '00000000-0000-4000-8000-000000000001', amount_paid: 10, payment_method: 'cash' }],
  ['/api/subscriptions/freeze', { id: '00000000-0000-4000-8000-000000000001', action: 'delete', freeze_id: '00000000-0000-4000-8000-000000000002' }],
  ['/api/subscriptions/update', { id: '00000000-0000-4000-8000-000000000001', patch: { amount_due: 0 } }],
  ['/api/subscriptions/delete', { id: '00000000-0000-4000-8000-000000000001' }],
  ['/api/membership-refunds/subscription-impact', { refund_id: '00000000-0000-4000-8000-000000000001', action: 'cancel_subscription', reason: 'Security regression' }],
]

const serverEnv = { ...process.env, NODE_ENV: 'production', PORT: String(port) }
delete serverEnv.SUPABASE_SERVICE_ROLE_KEY
delete serverEnv.SUPABASE_SECRET_KEY
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
  env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
server.stdout.on('data', chunk => { output += String(chunk).slice(-2000); output = output.slice(-5000) })
server.stderr.on('data', chunk => { output += String(chunk).slice(-2000); output = output.slice(-5000) })
let failed = false
try {
  let ready = false
  for (let attempt = 0; attempt < 45; attempt++) {
    if (server.exitCode !== null) throw new Error(`Server exited early (${server.exitCode}). ${output}`)
    try {
      const res = await fetch(origin + '/api/subscriptions/create', { signal: AbortSignal.timeout(1800) })
      if (res.status === 405 || res.status === 200 || res.status === 404) { ready = true; break }
    } catch {}
    await delay(750)
  }
  if (!ready) throw new Error(`Local Next server not ready. ${output}`)

  let checked = 0
  for (const [path, body] of fixtures) {
    for (const spoof of [false, true]) {
      const headers = { 'Content-Type': 'application/json' }
      if (spoof) {
        headers['Authorization'] = 'Bearer definitely-invalid-security-1c5-token'
        headers['x-user-role'] = 'super_admin'
        headers['x-user-id'] = '00000000-0000-4000-8000-000000000003'
      }
      const response = await fetch(origin + path, {
        method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
        redirect: 'manual',
      })
      const text = await response.text()
      assert.equal(response.status, 401,
        `${path} (${spoof ? 'spoofed' : 'anonymous'}) returned ${response.status}: ${text.slice(0,400)}`)
      assert.match(response.headers.get('content-type') ?? '', /application\/json/i,
        `${path} must return JSON`)
      const payload = JSON.parse(text)
      assert.equal(payload.ok, false, `${path} must explicitly deny access`)
      console.log(`PASS ${path} ${spoof ? 'spoofed headers' : 'anonymous'} → 401`)
      checked++
    }
  }
  console.log(`PASS: ${checked} anonymous/spoofed HTTP security checks; no authenticated writes performed.`)
} catch (error) {
  failed = true
  console.error('FAIL: financial HTTP security regression:', error.message)
} finally {
  server.kill('SIGTERM')
  await delay(500)
  if (server.exitCode === null) server.kill('SIGKILL')
}
if (failed) process.exitCode = 1
