export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { normalizeRole } from '@/lib/rbac'
import { resendRegistrationInvitation } from '@/lib/publicRegistrationInvitationRecovery'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function reply(body: object, status = 200) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

/** Super Admin only. No credentials, links, addresses or account IDs are returned. */
export async function POST(req: Request) {
  const browser = createSupabaseServerActionClient()
  const { data: session, error: authError } = await browser.auth.getUser()
  if (authError || !session.user) return reply({ ok: false, code: 'NOT_AUTHENTICATED' }, 401)

  const admin = createSupabaseAdminClient()
  const { data: actor, error: roleError } = await admin.from('profiles')
    .select('role').eq('user_id', session.user.id).maybeSingle()
  if (roleError) return reply({ ok: false, code: 'ROLE_UNAVAILABLE' }, 503)
  if (normalizeRole(actor?.role) !== 'super_admin') return reply({ ok: false, code: 'FORBIDDEN' }, 403)

  const input = await req.json().catch(() => null)
  if (!input || typeof input.request_id !== 'string' || !UUID.test(input.request_id) ||
      !['diagnose', 'resend'].includes(input.action))
    return reply({ ok: false, code: 'INVALID_INPUT' }, 400)

  if (input.action === 'resend') {
    const origin = req.headers.get('origin')
    const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
    if (!origin || !configured || origin !== new URL(configured).origin)
      return reply({ ok: false, code: 'ORIGIN_FORBIDDEN' }, 403)
    if (process.env.ATOM_REGISTRATION_INVITATION_RESEND_ENABLED !== 'true')
      return reply({ ok: false, code: 'RESEND_DISABLED' }, 409)
    if (input.confirm !== true || typeof input.reason !== 'string' ||
        input.reason.trim().length < 12 || input.reason.length > 1000)
      return reply({ ok: false, code: 'CONFIRMATION_AND_REASON_REQUIRED' }, 400)
  }

  try {
    const { data: row, error } = await admin.from('atom_public_registration_requests')
      .select('id,status,is_minor,identity_verified_at,account_email,verified_account_email,provisioning_claim_id,provisioned_auth_user_id,member_user_id,family_id,invitation_dispatched_at,invitation_email_id,password_setup_reported_at,account_activated_at,last_error_code')
      .eq('id', input.request_id).maybeSingle()
    if (error) return reply({ ok: false, code: 'STATE_UNAVAILABLE' }, 503)
    if (!row) return reply({ ok: false, code: 'NOT_FOUND' }, 404)

    if (row.status === 'completed' && row.account_activated_at)
      return reply({ ok: input.action !== 'resend', state: 'ACTIVATED', resend_allowed: false }, input.action === 'resend' ? 409 : 200)
    if (row.status !== 'invitation_pending' || row.account_activated_at || row.last_error_code ||
        !row.provisioned_auth_user_id || !row.provisioning_claim_id || !row.member_user_id ||
        (row.is_minor && !row.family_id) || !row.identity_verified_at ||
        !row.invitation_dispatched_at || !row.invitation_email_id ||
        !row.account_email || row.account_email.trim().toLowerCase() !== row.verified_account_email?.trim().toLowerCase())
      return reply({ ok: input.action !== 'resend', state: 'MANUAL_REVIEW', resend_allowed: false }, input.action === 'resend' ? 409 : 200)

    const { data: userResult, error: userError } = await admin.auth.admin.getUserById(row.provisioned_auth_user_id)
    if (userError) return reply({ ok: false, code: 'AUTH_LOOKUP_UNAVAILABLE' }, 503)
    const auth = userResult.user
    if (!auth || auth.email?.trim().toLowerCase() !== row.account_email.trim().toLowerCase() ||
        auth.app_metadata?.atom_registration_request_id !== row.id ||
        auth.app_metadata?.atom_registration_claim_id !== row.provisioning_claim_id)
      return reply({ ok: input.action !== 'resend', state: 'IDENTITY_REVIEW_REQUIRED', resend_allowed: false }, input.action === 'resend' ? 409 : 200)

    if (row.password_setup_reported_at)
      return reply({ ok: input.action !== 'resend', state: 'PASSWORD_REPORTED_ACTIVATION_INCOMPLETE', resend_allowed: false }, input.action === 'resend' ? 409 : 200)

    // A recorded sign-in is evidence of session use, NOT proof the password was set.
    // No admin resend in this state; let the account holder resume via their own
    // authenticated set-password page or the self-service password reset flow.
    if (auth.last_sign_in_at)
      return reply({ ok: input.action !== 'resend', state: 'SESSION_USED_ACTIVATION_INCOMPLETE', resend_allowed: false }, input.action === 'resend' ? 409 : 200)

    const { data: attempts, error: attemptError } = await admin
      .from('atom_registration_invitation_resend_attempts')
      .select('started_at,recorded_at').eq('request_id', row.id)
      .order('started_at', { ascending: false }).limit(4)
    if (attemptError) return reply({ ok: false, code: 'AUDIT_UNAVAILABLE' }, 503)
    const sentAt = Date.parse(row.invitation_dispatched_at)
    const latest = attempts?.[0]
    const now = Date.now()
    const eligible = process.env.ATOM_REGISTRATION_INVITATION_RESEND_ENABLED === 'true' &&
      (attempts?.length || 0) < 3 && !attempts?.some(a => !a.recorded_at) &&
      Number.isFinite(sentAt) && now - sentAt >= 15 * 60 * 1000 &&
      (!latest || now - Date.parse(latest.started_at) >= 15 * 60 * 1000)

    if (input.action === 'resend') {
      if (!eligible) return reply({ ok: false, code: 'RESEND_NOT_ELIGIBLE' }, 409)
      // The existing DB RPC locks and revalidates provenance, limits and cooldown.
      const result = await resendRegistrationInvitation(
        admin, row.id, row.provisioning_claim_id, session.user.id, input.reason.trim(),
      )
      return reply({ ok: result.ok === true, code: result.code }, result.ok ? 200 : 409)
    }

    return reply({
      ok: true,
      state: eligible ? 'RESEND_AVAILABLE' : 'INVITATION_PENDING',
      resend_allowed: eligible,
      resend_attempts: attempts?.length || 0,
    })
  } catch {
    return reply({ ok: false, code: 'RECOVERY_OUTCOME_UNCERTAIN_RECHECK_BEFORE_RETRY' }, 503)
  }
}
