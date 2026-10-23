/** Read-only display projection for Reception. Never authorizes provisioning or consent. */
export type RegistrationDeskCheckpoint = {
  status: string
  is_minor: boolean
  expires_at: string | null
  identity_verified_at: string | null
  provisioning_claim_id: string | null
  auth_provisioning_started_at: string | null
  provisioned_auth_user_id: string | null
  auth_provisioning_recorded_at: string | null
  member_user_id: string | null
  family_id: string | null
  invitation_dispatch_started_at: string | null
  invitation_dispatched_at: string | null
  account_activated_at: string | null
  last_error_code: string | null
}

export type RegistrationDeskDisplay = {
  label: string
  tone: string
  needsReview: boolean
  nextAction: string
}

const REVIEW = 'text-amber-900 bg-amber-50'
const WAIT = 'text-sky-900 bg-sky-50'
const DONE = 'text-emerald-800 bg-emerald-50'
const MUTED = 'text-slate-700 bg-slate-100'

export function registrationDeskDisplay(r: RegistrationDeskCheckpoint, now = Date.now()): RegistrationDeskDisplay {
  const review = (reason: string): RegistrationDeskDisplay => ({
    label: 'Needs admin review', tone: REVIEW, needsReview: true, nextAction: reason,
  })
  const waiting = (label: string, nextAction: string): RegistrationDeskDisplay => ({
    label, tone: WAIT, needsReview: false, nextAction,
  })
  // Detect conflicting durable state before showing any misleading 'completed' badge.
  if (r.account_activated_at && (r.status !== 'completed' || !r.invitation_dispatched_at || !r.provisioned_auth_user_id || !r.member_user_id))
    return review('Activation checkpoints do not agree. Ask Super Admin to inspect the record.')
  if (r.status === 'completed') {
    if (!r.account_activated_at) return review('Completion lacks verified account activation. Ask Super Admin to inspect.')
    return { label: 'Account activated', tone: DONE, needsReview: false, nextAction: 'Technical account activation recorded. Legal consent and membership access remain separate checks.' }
  }
  if (r.last_error_code || ['failed', 'rejected', 'expired'].includes(r.status))
    return review('Registration is blocked or rejected. Refer to Super Admin; do not recreate the account.')
  if (r.invitation_dispatched_at && (!r.member_user_id || !r.provisioned_auth_user_id || !r.identity_verified_at))
    return review('Invitation is recorded without complete identity or Member checkpoints. Escalate before any resend.')
  if (r.invitation_dispatch_started_at && !r.invitation_dispatched_at)
    return review('Invitation outcome is uncertain. Never resend automatically; contact Super Admin.')
  if (r.auth_provisioning_started_at && !r.auth_provisioning_recorded_at)
    return review('Auth creation may be interrupted. Super Admin must reconcile before retrying.')
  if (r.status === 'invitation_pending' && (!r.member_user_id || !r.provisioned_auth_user_id || (r.is_minor && !r.family_id)))
    return review('Account setup is incomplete. Do not send an invitation.')
  if (r.status === 'provisioning' && !r.provisioning_claim_id)
    return review('Provisioning has no recorded claim. Refer to Super Admin.')
  if (r.status === 'pending_verification' && r.identity_verified_at)
    return review('Verification state is inconsistent. Refer to Super Admin.')
  if (r.status === 'under_review' && !r.identity_verified_at)
    return review('Review state has no verified email. Refer to Super Admin.')
  if (r.expires_at && Date.parse(r.expires_at) <= now && ['pending_verification', 'under_review'].includes(r.status))
    return review('Request is expired. Ask Super Admin how to proceed; do not reuse its verification link.')
  if (r.invitation_dispatched_at)
    return waiting('Waiting for account setup', 'Ask the adult or parent to use the invitation link. Never request their password.')
  if (r.status === 'invitation_pending')
    return waiting('Preparing invitation', 'Provisioning is complete. Super Admin controls invitation dispatch.')
  if (r.status === 'provisioning')
    return waiting('Account setup in progress', 'Super Admin handles account provisioning. Do not create a second account.')
  if (r.status === 'under_review')
    return review('Email verified. Super Admin must approve the next provisioning step.')
  if (r.status === 'pending_verification')
    return { label: 'Waiting for email verification', tone: MUTED, needsReview: false, nextAction: 'Ask the adult or parent to verify their email. No account is ready yet.' }
  return review('Unknown registration state. Refer to Super Admin.')
}
