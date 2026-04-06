import type { Role } from '@/lib/rbac'

export type AccountActivationStatus = 'active' | 'invite_pending' | 'no_account' | 'auth_issue'

export type AccountActivationTone = 'success' | 'warning' | 'neutral' | 'danger'

export type AccountActivationProfile = {
  user_id: string | null
  member_id: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  role: Role | null
  created_at: string | null
}

export type AccountActivationAuthUser = {
  id?: string | null
  email?: string | null
  invited_at?: string | null
  email_confirmed_at?: string | null
  confirmed_at?: string | null
  last_sign_in_at?: string | null
} | null

export type AccountActivationRow = AccountActivationProfile & {
  account_status: AccountActivationStatus
  invited_at: string | null
  email_confirmed_at: string | null
  last_sign_in_at: string | null
  invite_age_days: number | null
}

function normalizeEmail(value?: string | null) {
  return String(value ?? '').trim().toLowerCase()
}

export function accountActivationLabel(status: AccountActivationStatus) {
  switch (status) {
    case 'active':
      return 'Active'
    case 'invite_pending':
      return 'Invite pending'
    case 'no_account':
      return 'No account'
    case 'auth_issue':
      return 'Auth issue'
    default:
      return 'Unknown'
  }
}

export function accountActivationTone(status: AccountActivationStatus): AccountActivationTone {
  switch (status) {
    case 'active':
      return 'success'
    case 'invite_pending':
      return 'warning'
    case 'no_account':
      return 'neutral'
    case 'auth_issue':
      return 'danger'
    default:
      return 'neutral'
  }
}

export function accountActivationDescription(status: AccountActivationStatus) {
  switch (status) {
    case 'active':
      return 'The member already activated the app account.'
    case 'invite_pending':
      return 'The invite was sent, but the member has not opened the email and finished account setup yet.'
    case 'no_account':
      return 'No usable app account was found for this member yet.'
    case 'auth_issue':
      return 'The member profile and auth account look inconsistent. Review this member from admin.'
    default:
      return 'Unknown account status.'
  }
}

export function accountActivationSortValue(status: AccountActivationStatus) {
  switch (status) {
    case 'invite_pending':
      return 0
    case 'auth_issue':
      return 1
    case 'no_account':
      return 2
    case 'active':
      return 3
    default:
      return 9
  }
}

export function deriveAccountActivationStatus(args: {
  profileUserId?: string | null
  profileEmail?: string | null
  authUser?: AccountActivationAuthUser
}): AccountActivationStatus {
  const profileUserId = String(args.profileUserId ?? '').trim()
  const profileEmail = normalizeEmail(args.profileEmail)
  const authUser = args.authUser ?? null
  const authEmail = normalizeEmail(authUser?.email)
  const invitedAt = authUser?.invited_at ?? null
  const confirmedAt = authUser?.email_confirmed_at ?? authUser?.confirmed_at ?? null
  const lastSignInAt = authUser?.last_sign_in_at ?? null

  if (!profileUserId) return 'auth_issue'

  if (!profileEmail && !authEmail) return 'no_account'

  if (!authUser) return 'no_account'

  if (profileEmail && authEmail && profileEmail !== authEmail) return 'auth_issue'

  if (lastSignInAt || confirmedAt) return 'active'

  if (invitedAt) return 'invite_pending'

  return 'auth_issue'
}
