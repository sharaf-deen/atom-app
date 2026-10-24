import 'server-only'

/** A conservative, read-only projection of the next *manual* provisioning step.
 * Not an authorization grant. Every existing mutation endpoint must recheck
 * Auth, role, provenance, feature flags and transactional database conditions.
 */
export type RegistrationOrchestrationRow = {
  status: string
  expires_at: string | null
  identity_verified_at: string | null
  verified_account_email: string | null
  account_email: string | null
  is_minor: boolean
  provisioning_claim_id: string | null
  auth_provisioning_started_at: string | null
  auth_provisioning_recorded_at: string | null
  provisioned_auth_user_id: string | null
  member_user_id: string | null
  family_id: string | null
  invitation_dispatch_started_at: string | null
  invitation_dispatched_at: string | null
  invitation_email_id: string | null
  account_activated_at: string | null
  last_error_code: string | null
}

export type OrchestrationStep =
  | 'WAIT_FOR_VERIFICATION' | 'REVIEW_IDENTITY_AND_CLAIM'
  | 'CREATE_AUTH_MANUALLY' | 'RECONCILE_AUTH'
  | 'COMPLETE_MEMBER_FAMILY_MANUALLY' | 'SEND_INVITATION_MANUALLY'
  | 'RECONCILE_INVITATION' | 'WAIT_FOR_ACTIVATION'
  | 'CHECK_LEGAL_CONSENT' | 'BLOCKED_REQUIRES_REVIEW'

export type RegistrationOrchestrationPlan = {
  step: OrchestrationStep
  readyForAutomaticExecution: false
  reviewRequired: boolean
  reason: string
}

const normalize = (value: string | null) => (value || '').trim().toLowerCase()

export function planRegistrationProvisioning(
  r: RegistrationOrchestrationRow,
  now: number = Date.now(),
): RegistrationOrchestrationPlan {
  const plan = (step: OrchestrationStep, reason: string, reviewRequired = false): RegistrationOrchestrationPlan => ({
    step, reason, reviewRequired, readyForAutomaticExecution: false,
  })
  const blocked = (reason: string) => plan('BLOCKED_REQUIRES_REVIEW', reason, true)
  if (r.last_error_code || ['failed', 'rejected', 'expired'].includes(r.status))
    return blocked('REQUEST_BLOCKED_OR_TERMINAL')
  if (!['pending_verification', 'under_review', 'provisioning', 'invitation_pending', 'completed'].includes(r.status))
    return blocked('UNKNOWN_STATUS')
  if (r.expires_at && Number.isNaN(Date.parse(r.expires_at))) return blocked('INVALID_EXPIRY')
  if (r.expires_at && Date.parse(r.expires_at) <= now && ['pending_verification', 'under_review'].includes(r.status))
    return blocked('REQUEST_EXPIRED')
  if (r.account_activated_at && (r.status !== 'completed' || !r.invitation_dispatched_at || !r.member_user_id))
    return blocked('ACTIVATION_CHECKPOINT_CONFLICT')
  if (r.status === 'completed') {
    if (!r.account_activated_at || !r.provisioned_auth_user_id || !r.member_user_id ||
        !r.invitation_dispatched_at || !r.invitation_email_id || (r.is_minor && !r.family_id))
      return blocked('COMPLETION_CHECKPOINT_CONFLICT')
    return plan('CHECK_LEGAL_CONSENT', 'ACCOUNT_ACTIVATED_LEGAL_CONSENT_SEPARATE')
  }
  if (r.status === 'pending_verification') {
    if (r.identity_verified_at || r.provisioning_claim_id || r.provisioned_auth_user_id)
      return blocked('VERIFICATION_STATUS_CONFLICT')
    return plan('WAIT_FOR_VERIFICATION', 'VERIFY_EMAIL_BEFORE_ANY_PROVISIONING')
  }
  if (!r.identity_verified_at || !r.account_email ||
      normalize(r.verified_account_email) !== normalize(r.account_email))
    return blocked('VERIFIED_EMAIL_MISSING_OR_MISMATCHED')
  if (r.invitation_dispatch_started_at && !r.invitation_dispatched_at)
    return plan('RECONCILE_INVITATION', 'INVITATION_OUTCOME_UNCERTAIN_DO_NOT_RESEND', true)
  if (r.invitation_dispatched_at && (!r.invitation_dispatch_started_at || !r.invitation_email_id))
    return blocked('INVITATION_RECEIPT_INCONSISTENT')
  if (r.auth_provisioning_started_at && !r.auth_provisioning_recorded_at)
    return plan('RECONCILE_AUTH', 'AUTH_OUTCOME_UNCERTAIN_DO_NOT_RECREATE', true)
  if (r.auth_provisioning_recorded_at && !r.provisioned_auth_user_id)
    return blocked('AUTH_RECORD_MISSING_ID')
  if (r.provisioned_auth_user_id && (!r.auth_provisioning_started_at || !r.auth_provisioning_recorded_at || !r.provisioning_claim_id))
    return blocked('AUTH_PROVENANCE_CHECKPOINT_CONFLICT')
  if (r.member_user_id && !r.provisioned_auth_user_id)
    return blocked('MEMBER_WITHOUT_AUTH_CHECKPOINT')
  if (r.is_minor && r.member_user_id && !r.family_id)
    return blocked('MINOR_WITHOUT_FAMILY')
  if (r.invitation_dispatched_at && (!r.member_user_id || !r.provisioned_auth_user_id || (r.is_minor && !r.family_id)))
    return blocked('INVITATION_WITH_INCOMPLETE_PROVISIONING')
  if (r.status === 'under_review') {
    if (r.provisioning_claim_id || r.member_user_id || r.provisioned_auth_user_id)
      return blocked('REVIEW_STATUS_CHECKPOINT_CONFLICT')
    return plan('REVIEW_IDENTITY_AND_CLAIM', 'IDENTITY_AUDIT_REQUIRED_BEFORE_CLAIM', true)
  }
  if (r.status === 'provisioning') {
    if (!r.provisioning_claim_id) return blocked('PROVISIONING_CLAIM_MISSING')
    if (!r.provisioned_auth_user_id) {
      if (r.auth_provisioning_recorded_at) return blocked('AUTH_RECORD_WITHOUT_ID')
      return plan('CREATE_AUTH_MANUALLY', 'EXPLICIT_SUPER_ADMIN_ACTION_REQUIRED', true)
    }
    if (r.member_user_id || r.family_id) return blocked('PARTIAL_MEMBER_FAMILY_STATE_REVIEW')
    return plan('COMPLETE_MEMBER_FAMILY_MANUALLY', 'EXPLICIT_SUPER_ADMIN_ACTION_REQUIRED', true)
  }
  if (r.status === 'invitation_pending') {
    if (!r.provisioning_claim_id || !r.provisioned_auth_user_id || !r.member_user_id ||
        (r.is_minor && !r.family_id)) return blocked('INCOMPLETE_MEMBER_FAMILY_CHECKPOINTS')
    if (!r.invitation_dispatched_at) return plan('SEND_INVITATION_MANUALLY', 'EXPLICIT_SUPER_ADMIN_ACTION_REQUIRED', true)
    return plan('WAIT_FOR_ACTIVATION', 'AWAIT_AUTHENTICATED_PASSWORD_SETUP')
  }
  return blocked('NO_SAFE_TRANSITION')
}
