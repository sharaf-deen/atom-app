export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { normalizeRole } from '@/lib/rbac'
import { auditRegistrationIdentity } from '@/lib/publicRegistrationIdentityAudit'
import { planRegistrationProvisioning, type RegistrationOrchestrationRow } from '@/lib/publicRegistrationOrchestrationPlan'
import { provisionNewRegistrationAuth } from '@/lib/publicRegistrationAuthProvisioning'
import { provisionRegistrationMemberFamily } from '@/lib/publicRegistrationMemberFamilyProvisioning'
import { dispatchProvisionedRegistrationInvitation } from '@/lib/publicRegistrationInvitation'

const VALID_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FIELDS = 'status,expires_at,identity_verified_at,verified_account_email,account_email,is_minor,provisioning_claim_id,auth_provisioning_started_at,auth_provisioning_recorded_at,provisioned_auth_user_id,member_user_id,family_id,invitation_dispatch_started_at,invitation_dispatched_at,invitation_email_id,account_activated_at,last_error_code'
type Action = 'APPROVE' | 'REJECT' | 'CREATE_AUTH' | 'COMPLETE_MEMBER_FAMILY' | 'SEND_INVITATION'
const feature: Record<Action, string | null> = {
  APPROVE: 'ATOM_REGISTRATION_PROVISIONING_CLAIM_ENABLED',
  REJECT: null,
  CREATE_AUTH: 'ATOM_REGISTRATION_AUTH_PROVISIONING_ENABLED',
  COMPLETE_MEMBER_FAMILY: 'ATOM_REGISTRATION_MEMBER_FAMILY_PROVISIONING_ENABLED',
  SEND_INVITATION: 'ATOM_REGISTRATION_INVITATION_ENABLED',
}

function reply(payload: object, status: number) {
  const response = NextResponse.json(payload, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

/** One explicit, Super Admin-approved transition per request. No chained/automatic provisioning. */
export async function POST(req: Request) {
  if (process.env.ATOM_REGISTRATION_FINAL_INTEGRATION_ENABLED !== 'true')
    return reply({ ok: false, code: 'FEATURE_DISABLED' }, 404)

  const origin = req.headers.get('origin')
  if (!origin || origin !== new URL(req.url).origin)
    return reply({ ok: false, code: 'ORIGIN_FORBIDDEN' }, 403)

  const client = createSupabaseServerActionClient()
  const { data: session, error: authError } = await client.auth.getUser()
  if (authError || !session.user) return reply({ ok: false, code: 'NOT_AUTHENTICATED' }, 401)

  const admin = createSupabaseAdminClient()
  const { data: actor, error: roleError } = await admin.from('profiles')
    .select('role').eq('user_id', session.user.id).maybeSingle()
  if (roleError) return reply({ ok: false, code: 'ROLE_LOOKUP_FAILED' }, 503)
  if (normalizeRole(actor?.role) !== 'super_admin') return reply({ ok: false, code: 'FORBIDDEN' }, 403)

  const body = await req.json().catch(() => null)
  const action = body?.action as Action
  if (!body || !VALID_UUID.test(body.request_id || '') ||
    !Object.prototype.hasOwnProperty.call(feature, action) || body.confirm !== true)
    return reply({ ok: false, code: 'INVALID_INPUT' }, 400)

  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (action === 'REJECT' && (reason.length < 10 || reason.length > 500))
    return reply({ ok: false, code: 'REASON_REQUIRED' }, 400)
  const flag = feature[action]
  if (flag && process.env[flag] !== 'true') return reply({ ok: false, code: 'STEP_DISABLED' }, 404)

  try {
    const { data: record, error } = await admin.from('atom_public_registration_requests')
      .select(FIELDS).eq('id', body.request_id).maybeSingle()
    if (error) return reply({ ok: false, code: 'STATE_LOOKUP_FAILED' }, 503)
    if (!record) return reply({ ok: false, code: 'NOT_FOUND' }, 404)

    const plan = planRegistrationProvisioning(record as RegistrationOrchestrationRow)
    if (action === 'REJECT') {
      // Reject only before claim / Auth creation, including a request still awaiting email verification.
      if (!['pending_verification', 'under_review'].includes(record.status) ||
          record.provisioning_claim_id || record.provisioned_auth_user_id ||
          record.member_user_id || record.family_id || record.invitation_dispatch_started_at)
        return reply({ ok: false, code: 'REJECTION_NOT_ALLOWED' }, 409)
      const { data: rejected, error: updateError } = await admin.from('atom_public_registration_requests')
        .update({ status: 'rejected', updated_at: new Date().toISOString(),
          processed_at: new Date().toISOString(), review_decision_by: session.user.id,
          review_decision_at: new Date().toISOString(), review_reason: reason })
        .eq('id', body.request_id)
        .in('status', ['pending_verification', 'under_review'])
        .is('provisioning_claim_id', null)
        .is('provisioned_auth_user_id', null)
        .is('member_user_id', null)
        .is('family_id', null)
        .is('invitation_dispatch_started_at', null)
        .select('id')
        .maybeSingle()
      if (updateError) return reply({ ok: false, code: 'REJECTION_FAILED' }, 503)
      if (!rejected) return reply({ ok: false, code: 'STATE_CHANGED_REVIEW_REQUIRED' }, 409)
      return reply({ ok: true, code: 'REQUEST_REJECTED' }, 200)
    }

    const expected: Record<Exclude<Action, 'REJECT'>, string> = {
      APPROVE: 'REVIEW_IDENTITY_AND_CLAIM',
      CREATE_AUTH: 'CREATE_AUTH_MANUALLY',
      COMPLETE_MEMBER_FAMILY: 'COMPLETE_MEMBER_FAMILY_MANUALLY',
      SEND_INVITATION: 'SEND_INVITATION_MANUALLY',
    }
    if (plan.step !== expected[action])
      return reply({ ok: false, code: 'TRANSITION_NOT_ALLOWED', nextStep: plan.step }, 409)

    if (action === 'APPROVE') {
      const audit = await auditRegistrationIdentity(admin, body.request_id)
      if (!audit.safeForNewAuth) return reply({ ok: false, code: 'IDENTITY_REVIEW_REQUIRED' }, 409)
      const { data, error: claimError } = await admin.rpc('atom_claim_registration_provisioning_v1', {
        p_request_id: body.request_id, p_claim_id: randomUUID(),
      })
      if (claimError) return reply({ ok: false, code: 'CLAIM_OUTCOME_UNCERTAIN_REVIEW' }, 503)
      const claimed = Array.isArray(data) ? data[0] : data
      return reply({ ok: claimed?.claimed === true, code: claimed?.claimed === true ? 'APPROVED' : 'CLAIM_NOT_GRANTED' },
        claimed?.claimed === true ? 200 : 409)
    }

    if (!record.provisioning_claim_id || !VALID_UUID.test(record.provisioning_claim_id))
      return reply({ ok: false, code: 'CLAIM_NOT_FOUND' }, 409)
    let result: { ok: boolean; code?: string }
    if (action === 'CREATE_AUTH')
      result = await provisionNewRegistrationAuth(admin, body.request_id, record.provisioning_claim_id)
    else if (action === 'COMPLETE_MEMBER_FAMILY')
      result = await provisionRegistrationMemberFamily(admin, body.request_id, record.provisioning_claim_id, session.user.id)
    else
      result = await dispatchProvisionedRegistrationInvitation(admin, body.request_id, record.provisioning_claim_id, session.user.id)
    return reply({ ok: result.ok === true, code: result.code || 'ACTION_REQUIRES_REVIEW' }, result.ok ? 200 : 409)
  } catch {
    // External Auth/email steps may have succeeded before a network failure.
    return reply({ ok: false, code: 'OUTCOME_UNCERTAIN_REVIEW_BEFORE_RETRY' }, 503)
  }
}
