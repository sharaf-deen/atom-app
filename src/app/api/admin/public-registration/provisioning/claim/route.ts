export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { normalizeRole } from '@/lib/rbac'
import { auditRegistrationIdentity } from '@/lib/publicRegistrationIdentityAudit'
import { planRegistrationProvisioning, type RegistrationOrchestrationRow } from '@/lib/publicRegistrationOrchestrationPlan'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FIELDS = 'status,expires_at,identity_verified_at,verified_account_email,account_email,is_minor,provisioning_claim_id,auth_provisioning_started_at,auth_provisioning_recorded_at,provisioned_auth_user_id,member_user_id,family_id,invitation_dispatch_started_at,invitation_dispatched_at,invitation_email_id,account_activated_at,last_error_code'

function reply(body: object, status: number) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

/** Super Admin explicit claim only. No Auth, Member, Family, invitation or payment writes. */
export async function POST(req: Request) {
  if (process.env.ATOM_REGISTRATION_PROVISIONING_CLAIM_ENABLED !== 'true')
    return reply({ ok: false, code: 'FEATURE_DISABLED' }, 404)

  // Reject cross-site authenticated POSTs (session cookies are not a CSRF authorization).
  const origin = req.headers.get('origin')
  const target = new URL(req.url)
  const forwardedHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || target.host
  const expectedOrigin = `${target.protocol}//${forwardedHost}`
  if (!origin || origin !== expectedOrigin)
    return reply({ ok: false, code: 'INVALID_ORIGIN' }, 403)

  const client = createSupabaseServerActionClient()
  const { data: session, error: authError } = await client.auth.getUser()
  if (authError || !session.user) return reply({ ok: false, code: 'NOT_AUTHENTICATED' }, 401)
  const admin = createSupabaseAdminClient()
  const { data: actor, error: roleError } = await admin.from('profiles')
    .select('role').eq('user_id', session.user.id).maybeSingle()
  if (roleError) return reply({ ok: false, code: 'ROLE_LOOKUP_FAILED' }, 503)
  if (normalizeRole(actor?.role) !== 'super_admin')
    return reply({ ok: false, code: 'FORBIDDEN' }, 403)

  const body = await req.json().catch(() => null)
  if (!body || typeof body.request_id !== 'string' || !UUID.test(body.request_id) || body.confirm !== true)
    return reply({ ok: false, code: 'INVALID_INPUT' }, 400)

  try {
    // Advisory preflight only; DB RPC is the final atomic authority under concurrency.
    const { data: record, error: lookupError } = await admin.from('atom_public_registration_requests')
      .select(FIELDS).eq('id', body.request_id).maybeSingle()
    if (lookupError) return reply({ ok: false, code: 'STATE_LOOKUP_FAILED' }, 503)
    if (!record) return reply({ ok: false, code: 'NOT_FOUND' }, 404)
    const plan = planRegistrationProvisioning(record as RegistrationOrchestrationRow)
    if (plan.step !== 'REVIEW_IDENTITY_AND_CLAIM')
      return reply({ ok: false, code: 'CLAIM_NOT_ALLOWED', nextStep: plan.step }, 409)

    const audit = await auditRegistrationIdentity(admin, body.request_id)
    if (!audit.safeForNewAuth)
      return reply({ ok: false, code: 'IDENTITY_REVIEW_REQUIRED' }, 409)

    const claimId = randomUUID()
    const { data, error: claimError } = await admin.rpc('atom_claim_registration_provisioning_v1', {
      p_request_id: body.request_id,
      p_claim_id: claimId,
    })
    if (claimError) {
      console.error('[registration-provisioning/claim] RPC failed', {
        dbCode: typeof claimError.code === 'string' ? claimError.code.slice(0, 12) : 'UNKNOWN',
      })
      return reply({ ok: false, code: 'CLAIM_OUTCOME_UNCERTAIN_REVIEW_STATE' }, 503)
    }
    const claim = Array.isArray(data) ? data[0] : data
    if (claim?.claimed !== true)
      return reply({ ok: false, code: 'CLAIM_NOT_GRANTED', reason: 'NOT_READY_OR_ALREADY_CLAIMED' }, 409)

    // Claim ID is needed for a later, separately authorized Auth operation.
    // It is returned only to the authenticated Super Admin, never logged.
    return reply({ ok: true, code: 'CLAIMED', claim_id: claimId, nextStep: 'CREATE_AUTH_MANUALLY' }, 200)
  } catch {
    // An ambiguous outcome must be inspected; never auto-retry with another claim ID.
    return reply({ ok: false, code: 'CLAIM_OUTCOME_UNCERTAIN_REVIEW_STATE' }, 503)
  }
}
