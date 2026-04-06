import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import {
  deriveAccountActivationStatus,
  type AccountActivationAuthUser,
  type AccountActivationProfile,
  type AccountActivationRow,
  type AccountActivationStatus,
} from '@/lib/accountActivation'

const AUTH_USERS_PER_PAGE = 1000
const AUTH_USERS_MAX_PAGES = 20

function daysSince(iso?: string | null) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const diff = Date.now() - t
  if (diff < 0) return 0
  return Math.floor(diff / 86400000)
}

async function listAllAuthUsers(admin: any) {
  const users: any[] = []

  for (let page = 1; page <= AUTH_USERS_MAX_PAGES; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: AUTH_USERS_PER_PAGE })
    if (error) throw new Error(`AUTH_LIST_USERS_ERROR: ${error.message}`)

    const batch = (data?.users ?? []) as any[]
    users.push(...batch)

    if (batch.length < AUTH_USERS_PER_PAGE) break
  }

  return users
}

function toAuthSnapshot(user: any): AccountActivationAuthUser {
  if (!user) return null
  return {
    id: user.id ?? null,
    email: user.email ?? null,
    invited_at: user.invited_at ?? null,
    email_confirmed_at: user.email_confirmed_at ?? null,
    confirmed_at: user.confirmed_at ?? null,
    last_sign_in_at: user.last_sign_in_at ?? null,
  }
}

function toAccountActivationRow(profile: AccountActivationProfile, authUser: AccountActivationAuthUser): AccountActivationRow {
  const invitedAt = authUser?.invited_at ?? null
  const emailConfirmedAt = authUser?.email_confirmed_at ?? authUser?.confirmed_at ?? null
  const lastSignInAt = authUser?.last_sign_in_at ?? null

  return {
    ...profile,
    account_status: deriveAccountActivationStatus({
      profileUserId: profile.user_id,
      profileEmail: profile.email,
      authUser,
    }),
    invited_at: invitedAt,
    email_confirmed_at: emailConfirmedAt,
    last_sign_in_at: lastSignInAt,
    invite_age_days: daysSince(invitedAt),
  }
}

export async function listAccountActivationRows(): Promise<AccountActivationRow[]> {
  const admin = createSupabaseAdminClient()

  const { data: profiles, error } = await admin
    .from('profiles')
    .select('user_id, member_id, email, first_name, last_name, role, created_at')
    .order('created_at', { ascending: false, nullsFirst: false })

  if (error) {
    throw new Error(`PROFILES_LIST_ERROR: ${error.message}`)
  }

  const authUsers = await listAllAuthUsers(admin)
  const authById = new Map<string, AccountActivationAuthUser>()
  for (const user of authUsers) {
    const id = String(user?.id ?? '').trim()
    if (!id) continue
    authById.set(id, toAuthSnapshot(user))
  }

  return ((profiles ?? []) as AccountActivationProfile[]).map((profile) => {
    const authUser = authById.get(String(profile.user_id ?? '').trim()) ?? null
    return toAccountActivationRow(profile, authUser)
  })
}

export async function getAccountActivationForMemberUserId(memberUserId: string): Promise<AccountActivationStatus> {
  const id = String(memberUserId ?? '').trim()
  if (!id) return 'auth_issue'

  const admin = createSupabaseAdminClient()
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('user_id, member_id, email, first_name, last_name, role, created_at')
    .eq('user_id', id)
    .maybeSingle<AccountActivationProfile>()

  if (profileError) {
    throw new Error(`PROFILE_LOOKUP_ERROR: ${profileError.message}`)
  }

  if (!profile?.user_id) return 'no_account'

  let authUser: AccountActivationAuthUser = null
  try {
    const { data, error } = await admin.auth.admin.getUserById(id)
    if (error) throw error
    authUser = toAuthSnapshot(data?.user ?? null)
  } catch {
    authUser = null
  }

  return deriveAccountActivationStatus({
    profileUserId: profile.user_id,
    profileEmail: profile.email,
    authUser,
  })
}
