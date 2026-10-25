export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { normalizeRole } from '@/lib/rbac'
import { planRegistrationProvisioning, type RegistrationOrchestrationRow } from '@/lib/publicRegistrationOrchestrationPlan'
import { reconcileInterruptedRegistrationAuth } from '@/lib/publicRegistrationAuthReconciliation'
import { provisionRegistrationMemberFamily } from '@/lib/publicRegistrationMemberFamilyProvisioning'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FIELDS = 'status,expires_at,identity_verified_at,verified_account_email,account_email,is_minor,provisioning_claim_id,auth_provisioning_started_at,auth_provisioning_recorded_at,provisioned_auth_user_id,member_user_id,family_id,invitation_dispatch_started_at,invitation_dispatched_at,invitation_email_id,account_activated_at,last_error_code'
type SafeAction = 'RECONCILE_AUTH' | 'COMPLETE_MEMBER_FAMILY'

function reply(body: object, status: number) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

/** Explicit Super Admin transition. No Auth creation, invitation sending, or automatic retries. */
export async function POST(req: Request) {
  if (process.env.ATOM_REGISTRATION_SAFE_TRANSITIONS_ENABLED !== 'true')
    return reply({ ok: false, code: 'FEATURE_DISABLED' }, 404)

  const client = createSupabaseServerActionClient()
  const { data: session, error: authError } = await client.auth.getUser()
  if (authError || !session.user) return reply({ ok: false, code: 'NOT_AUTHENTICATED' }, 401)
  const admin = createSupabaseAdminClient()
  const { data: actor, error: roleError } = await admin.from('profiles')
    .select('role').eq('user_id', session.user.id).maybeSingle()
  if (roleError) return reply({ ok: false, code: 'ROLE_LOOKUP_FAILED' }, 503)
  if (normalizeRole(actor?.role) !== 'super_admin') return reply({ ok: false, code: 'FORBIDDEN' }, 403)

  const body = await req.json().catch(() => null)
  if (!body || typeof body.request_id !== 'string' || !UUID.test(body.request_id) ||
      (body.action !== 'RECONCILE_AUTH' && body.action !== 'COMPLETE_MEMBER_FAMILY') ||
      body.confirm !== true)
    return reply({ ok: false, code: 'INVALID_INPUT' }, 400)
  const action: SafeAction = body.action
  if (action === 'RECONCILE_AUTH' && (typeof body.reason !== 'string' ||
      body.reason.trim().length < 10 || body.reason.trim().length > 1000))
    return reply({ ok: false, code: 'REASON_REQUIRED' }, 400)

  try {
    // Re-read server-side state before any action. The existing RPC is the final
    // transactional authority: it revalidates claim, state and Auth provenance.
    const { data: request, error } = await admin.from('atom_public_registration_requests')
      .select(FIELDS).eq('id', body.request_id).maybeSingle()
    if (error) return reply({ ok: false, code: 'STATE_LOOKUP_FAILED' }, 503)
    if (!request) return reply({ ok: false, code: 'NOT_FOUND' }, 404)
    const plan = planRegistrationProvisioning(request as RegistrationOrchestrationRow)
    if (plan.step !== action) return reply({ ok: false, code: 'TRANSITION_NOT_ALLOWED', nextStep: plan.step }, 409)

    if (action === 'RECONCILE_AUTH') {
      // Exact app_metadata provenance + email checked by the recovery helper;
      // audit written by existing atom_reconcile_registration_auth_v1 RPC.
      const result = await reconcileInterruptedRegistrationAuth(admin, body.request_id,
        session.user.id, body.reason.trim())
      return reply({ ok: result.ok === true, code: result.code }, result.ok ? 200 : 409)
    }
    if (!request.provisioning_claim_id || !UUID.test(request.provisioning_claim_id))
      return reply({ ok: false, code: 'CLAIM_NOT_FOUND' }, 409)
    // Existing RPC atomically applies Member+Family writes (or none), and
    // checks claim, provenance and member/family uniqueness under DB locks.
    const result = await provisionRegistrationMemberFamily(admin, body.request_id,
      request.provisioning_claim_id, session.user.id)
    return reply({ ok: result.ok === true, code: result.code }, result.ok ? 200 : 409)
  } catch {
    // A timed-out response is ambiguous. Never automatically attempt again.
    return reply({ ok: false, code: 'OUTCOME_UNCERTAIN_REVIEW_BEFORE_RETRY' }, 503)
  }
}
