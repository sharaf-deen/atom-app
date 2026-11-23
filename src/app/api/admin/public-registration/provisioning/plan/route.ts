export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

/** Read-only Super Admin diagnostic. Never claims, provisions, sends or finalizes. */
export async function POST(req: Request) {
  const client = createSupabaseServerActionClient()
  const { data: session, error: authError } = await client.auth.getUser()
  if (authError || !session.user) return reply({ ok: false, code: 'NOT_AUTHENTICATED' }, 401)
  const admin = createSupabaseAdminClient()
  const { data: actor, error: roleError } = await admin.from('profiles')
    .select('role').eq('user_id', session.user.id).maybeSingle()
  if (roleError) return reply({ ok: false, code: 'ROLE_LOOKUP_FAILED' }, 503)
  if (normalizeRole(actor?.role) !== 'super_admin') return reply({ ok: false, code: 'FORBIDDEN' }, 403)
  const body = await req.json().catch(() => null)
  if (!body || typeof body.request_id !== 'string' || !UUID.test(body.request_id))
    return reply({ ok: false, code: 'INVALID_INPUT' }, 400)
  try {
    const { data, error } = await admin.from('atom_public_registration_requests')
      .select(FIELDS).eq('id', body.request_id).maybeSingle()
    if (error) return reply({ ok: false, code: 'PLAN_UNAVAILABLE' }, 503)
    if (!data) return reply({ ok: false, code: 'NOT_FOUND' }, 404)

    const plan = planRegistrationProvisioning(data as RegistrationOrchestrationRow)

    // The orchestration row alone cannot detect duplicate/existing identities.
    // Run the same read-only identity audit used by the mutation endpoint before
    // we ever advertise APPROVE. This keeps the UI and server transition aligned
    // and prevents a misleading approval button for existing-account cases.
    if (plan.step === 'REVIEW_IDENTITY_AND_CLAIM') {
      const audit = await auditRegistrationIdentity(admin, body.request_id)
      if (!audit.safeForNewAuth) {
        return reply({
          ok: true,
          plan: {
            step: 'BLOCKED_REQUIRES_REVIEW',
            reason: audit.reason,
            reviewRequired: true,
            readyForAutomaticExecution: false,
          },
        }, 200)
      }
    }

    // Never expose email, Auth IDs, claim IDs or other personal/sensitive record fields.
    return reply({ ok: true, plan }, 200)
  } catch {
    return reply({ ok: false, code: 'PLAN_UNAVAILABLE' }, 503)
  }
}
