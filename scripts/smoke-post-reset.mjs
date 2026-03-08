#!/usr/bin/env node
/**
 * Smoke test post-reset:
 * - Create user (admin)
 * - Login (anon)
 * - Create profile (admin) + assert member_id generation
 * - Update existing profile + assert member_id is preserved
 * - Create subscription (admin)
 * - Upload invoice PDF to Storage (admin)
 * - Create invoice row (admin)
 * - Validate via RPC: search_members + search_invoices (admin)
 *
 * Exit code 0 = OK, 1 = FAIL
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execSync } from 'node:child_process'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

function logStep(title) {
  console.log(`\n=== ${title} ===`)
}

function logOk(msg) {
  console.log(`✅ ${msg}`)
}

function logWarn(msg) {
  console.warn(`⚠️  ${msg}`)
}

function logFail(msg) {
  console.error(`❌ ${msg}`)
}

function parseDotenvFile(filePath) {
  const out = {}
  const raw = fs.readFileSync(filePath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 0) continue
    const key = t.slice(0, eq).trim()
    let val = t.slice(eq + 1).trim()
    // strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

function loadEnvFromFiles() {
  const candidates = [
    '.env.local',
    '.env',
    '.env.development.local',
    '.env.test.local',
    '.env.production.local',
  ]
  const cwd = process.cwd()
  for (const f of candidates) {
    const p = path.join(cwd, f)
    if (!fs.existsSync(p)) continue
    try {
      const parsed = parseDotenvFile(p)
      for (const [k, v] of Object.entries(parsed)) {
        if (process.env[k] == null || process.env[k] === '') process.env[k] = v
      }
      logOk(`Loaded env from ${f}`)
    } catch (e) {
      logWarn(`Couldn't parse ${f}: ${e?.message ?? e}`)
    }
  }
}

function parseSupabaseStatus(stdout) {
  // Matches the table-like output:
  // Project URL    │ http://127.0.0.1:54321
  // Publishable │ sb_publishable_...
  // Secret      │ sb_secret_...
  const urlMatch = stdout.match(/Project URL\s*\│\s*(https?:\/\/[^\s]+)/i)
  const anonMatch = stdout.match(/Publishable\s*\│\s*(\S+)/i)
  const serviceMatch = stdout.match(/Secret\s*\│\s*(\S+)/i)

  return {
    url: urlMatch?.[1] ?? null,
    anon: anonMatch?.[1] ?? null,
    service: serviceMatch?.[1] ?? null,
  }
}

function resolveSupabaseCreds() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    'http://127.0.0.1:54321'

  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || null
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || null

  if (anon && service) return { url, anon, service }

  // Try to auto-detect from `supabase status`
  try {
    const out = execSync('npx supabase status', { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' })
    const parsed = parseSupabaseStatus(out)
    return {
      url: parsed.url ?? url,
      anon: anon ?? parsed.anon,
      service: service ?? parsed.service,
    }
  } catch (e) {
    return { url, anon, service }
  }
}

function isoDate(d) {
  return d.toISOString().slice(0, 10)
}

function assertValidMemberId(value, context = 'member_id') {
  if (typeof value !== 'string' || !/^ATOM-\d{6}$/.test(value)) {
    throw new Error(`INVALID_MEMBER_ID_${context.toUpperCase()}: ${String(value)}`)
  }
}

async function main() {
  loadEnvFromFiles()
  const { url, anon, service } = resolveSupabaseCreds()

  if (!anon || !service) {
    logFail(
      `Missing Supabase keys.\n` +
        `Set NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (in .env.local), ` +
        `or run with Supabase running so the script can parse them from "npx supabase status".`
    )
    process.exit(1)
  }

  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'atom-smoke/admin' } },
  })

  const anonClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'atom-smoke/anon' } },
  })

  const runId = crypto.randomUUID().slice(0, 8)
  const email = `smoke_${Date.now()}_${runId}@example.com`
  const password = `Aa!${crypto.randomBytes(18).toString('base64url')}`

  let userId = null
  let subscriptionId = null
  let invoiceId = null
  let invoicePath = null
  let initialMemberId = null

  try {
    logStep('1) Create user (admin)')
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (created.error) throw created.error
    userId = created.data.user?.id
    if (!userId) throw new Error('ADMIN_CREATE_USER_NO_ID')
    logOk(`User created: ${email} (${userId})`)

    logStep('2) Login (anon)')
    const signed = await anonClient.auth.signInWithPassword({ email, password })
    if (signed.error) throw signed.error
    if (!signed.data.session) throw new Error('SIGNIN_NO_SESSION')
    logOk('Login OK (session created)')

    logStep('3) Create/ensure profile (admin)')
    const prof = await admin
      .from('profiles')
      .upsert(
        {
          user_id: userId,
          email,
          first_name: 'Smoke',
          last_name: 'Test',
          role: 'member',
          phone: null,
        },
        { onConflict: 'user_id' }
      )
      .select('user_id, member_id, role')
      .maybeSingle()

    if (prof.error) throw prof.error
    initialMemberId = prof.data?.member_id ?? null
    assertValidMemberId(initialMemberId, 'after_profile_upsert')
    logOk(`Profile OK (member_id=${initialMemberId})`)

    logStep('3.1) Update existing profile and ensure member_id is preserved')
    const profUpdate = await admin
      .from('profiles')
      .update({ first_name: 'SmokeUpdated' })
      .eq('user_id', userId)
      .select('user_id, member_id, first_name')
      .single()

    if (profUpdate.error) throw profUpdate.error
    assertValidMemberId(profUpdate.data?.member_id ?? null, 'after_profile_update')
    if (profUpdate.data?.member_id !== initialMemberId) {
      throw new Error(
        `MEMBER_ID_CHANGED_ON_PROFILE_UPDATE: before=${initialMemberId} after=${String(profUpdate.data?.member_id)}`
      )
    }
    logOk(`Profile update preserved member_id (${profUpdate.data.member_id})`)

    logStep('4) Create subscription (admin)')
    const now = new Date()
    const start_date = isoDate(now)
    const end_date = isoDate(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000))

    const sub = await admin
      .from('subscriptions')
      .insert({
        member_id: userId,
        plan: '1m',
        subscription_type: 'time',
        start_date,
        end_date,
        status: 'active',
        amount: 1200,
        payment_method: 'cash',
        amount_due: 0,
      })
      .select('id')
      .single()

    if (sub.error) throw sub.error
    subscriptionId = sub.data.id
    logOk(`Subscription created: ${subscriptionId}`)

    // NOTE: members_with_activity_mv is a MATERIALIZED VIEW.
    // Triggers only mark it as "dirty"; we must explicitly refresh it for deterministic smoke tests.
    logStep('4.1) Refresh members activity materialized view (admin)')
    const refreshed = await admin.rpc('refresh_members_with_activity_mv')
    if (refreshed.error) throw refreshed.error
    logOk(`MV refresh OK (refreshed=${String(refreshed.data)})`)

    logStep('5) Upload invoice PDF to Storage (admin)')
    const invoice_number = `SMOKE-${Date.now()}-${runId}`
    invoicePath = `${userId}/${invoice_number}.pdf`

    // Minimal valid-ish PDF bytes
    const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'utf8')

    const up = await admin.storage.from('invoices').upload(invoicePath, pdfBytes, {
      contentType: 'application/pdf',
      upsert: true,
    })
    if (up.error) throw up.error
    logOk(`Storage upload OK: invoices/${invoicePath}`)

    logStep('6) Insert invoice row (admin)')
    const paid_at = new Date().toISOString()
    const snapshot = {
      invoice_number,
      created_at: paid_at,
      transaction: {
        amount: 1200,
        currency: 'EGP',
        payment_method: 'cash',
      },
      member: {
        user_id: userId,
        email,
        first_name: 'Smoke',
        last_name: 'Test',
      },
      subscription: {
        id: subscriptionId,
        plan: '1m',
        start_date,
        end_date,
      },
      meta: { smoke: true, run_id: runId },
    }

    const inv = await admin
      .from('invoices')
      .insert({
        member_id: userId,
        subscription_id: subscriptionId,
        invoice_number,
        amount: 1200,
        currency: 'EGP',
        paid_at,
        pdf_path: invoicePath,
        snapshot,
      })
      .select('id, invoice_number')
      .single()

    if (inv.error) throw inv.error
    invoiceId = inv.data.id
    logOk(`Invoice created: ${inv.data.invoice_number} (${invoiceId})`)

    logStep('7) Validate RPC: search_members + search_invoices')
    const mRes = await admin.rpc('search_members', { q: email, status: 'all', page: 1, page_size: 10 })
    if (mRes.error) throw mRes.error
    const members = Array.isArray(mRes.data) ? mRes.data : []
    if (!members.some((m) => (m.email ?? '').toLowerCase() === email.toLowerCase())) {
      throw new Error('RPC_SEARCH_MEMBERS_DID_NOT_RETURN_CREATED_USER')
    }
    logOk('search_members OK')

    const iRes = await admin.rpc('search_invoices', { q: `SMOKE-${runId}`, from_date: null, to_date: null, page: 1, page_size: 10 })
    if (iRes.error) throw iRes.error
    const invoices = Array.isArray(iRes.data) ? iRes.data : []
    if (!invoices.some((r) => r.invoice_number === inv.data.invoice_number)) {
      // fallback: search by exact invoice_number
      const iRes2 = await admin.rpc('search_invoices', { q: inv.data.invoice_number, from_date: null, to_date: null, page: 1, page_size: 10 })
      if (iRes2.error) throw iRes2.error
      const invoices2 = Array.isArray(iRes2.data) ? iRes2.data : []
      if (!invoices2.some((r) => r.invoice_number === inv.data.invoice_number)) {
        throw new Error('RPC_SEARCH_INVOICES_DID_NOT_RETURN_CREATED_INVOICE')
      }
    }
    logOk('search_invoices OK')

    console.log('\n🎉 Smoke test PASSED: reset = app OK (core flows).')
    process.exit(0)
  } catch (e) {
    logFail(e?.message ?? String(e))
    // print more detail if supabase error object
    if (e?.details) console.error('Details:', e.details)
    if (e?.hint) console.error('Hint:', e.hint)
    if (e?.code) console.error('Code:', e.code)
    process.exitCode = 1
  } finally {
    logStep('Cleanup (best effort)')
    try {
      if (invoiceId) {
        await admin.from('invoices').delete().eq('id', invoiceId)
        logOk('Deleted invoice row')
      }
    } catch (e) {
      logWarn(`Couldn't delete invoice row: ${e?.message ?? e}`)
    }

    try {
      if (invoicePath) {
        await admin.storage.from('invoices').remove([invoicePath])
        logOk('Deleted invoice PDF from storage')
      }
    } catch (e) {
      logWarn(`Couldn't delete invoice file: ${e?.message ?? e}`)
    }

    try {
      if (subscriptionId) {
        await admin.from('subscriptions').delete().eq('id', subscriptionId)
        logOk('Deleted subscription row')
      }
    } catch (e) {
      logWarn(`Couldn't delete subscription row: ${e?.message ?? e}`)
    }

    try {
      if (userId) {
        await admin.from('profiles').delete().eq('user_id', userId)
        logOk('Deleted profile row')
      }
    } catch (e) {
      logWarn(`Couldn't delete profile row: ${e?.message ?? e}`)
    }

    try {
      if (userId) {
        await admin.auth.admin.deleteUser(userId)
        logOk('Deleted auth user')
      }
    } catch (e) {
      logWarn(`Couldn't delete auth user: ${e?.message ?? e}`)
    }
  }

  process.exit(process.exitCode || 0)
}

await main()
