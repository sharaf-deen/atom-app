export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { randomUUID } from 'crypto'
import { revalidatePath, revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { MEMBER_LIKE_ROLES, normalizeRole } from '@/lib/rbac'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { extractActionLink, sendFamilyParentInviteEmail } from '@/lib/memberInviteEmail'

type ActionBody =
  | { action?: 'create'; familyName?: string }
  | { action?: 'rename_family'; familyId?: string; familyName?: string }
  | { action?: 'delete_family'; familyId?: string }
  | { action?: 'link_member'; familyId?: string; memberId?: string }
  | { action?: 'unlink_member'; familyId?: string; memberId?: string }
  | {
      action?: 'create_parent_account'
      familyId?: string
      email?: string
      firstName?: string
      lastName?: string
      phone?: string
    }
  | {
      action?: 'create_guardian_account'
      familyId?: string
      email?: string
      firstName?: string
      lastName?: string
      phone?: string
    }
  | { action?: 'set_primary_guardian'; familyId?: string; authUserId?: string }
  | {
      action?: 'update_guardian'
      familyId?: string
      authUserId?: string
      firstName?: string
      lastName?: string
      phone?: string
    }
  | { action?: 'remove_guardian'; familyId?: string; authUserId?: string }
  | { action?: 'promote_guardian_to_member'; familyId?: string; authUserId?: string }
  | { action?: 'preview_guardian_member_cleanup'; familyId?: string; authUserId?: string }
  | { action?: 'remove_guardian_member_profile'; familyId?: string; authUserId?: string }
  | {
      action?: 'create_dependent_member'
      familyId?: string
      firstName?: string
      lastName?: string
      phone?: string
      dateOfBirth?: string
    }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function noStore(body: any, init?: ResponseInit) {
  const response = NextResponse.json(body, init)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function normalizeFamilyName(value: unknown) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

function isValidDateOnly(dateOnly: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return false
  const [year, month, day] = dateOnly.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  )
}

function todayUtcDateOnly() {
  return new Date().toISOString().slice(0, 10)
}

async function requireAdminActor() {
  const supabase = createSupabaseServerActionClient()
  const { data: authData, error: authError } = await supabase.auth.getUser()

  if (authError || !authData.user) {
    return { error: noStore({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }) } as const
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', authData.user.id)
    .maybeSingle()

  if (profileError) {
    return {
      error: noStore(
        { ok: false, error: 'ACTOR_PROFILE_ERROR', details: profileError.message },
        { status: 500 },
      ),
    } as const
  }

  const role = normalizeRole(profile?.role)
  if (role !== 'admin' && role !== 'super_admin') {
    return { error: noStore({ ok: false, error: 'FORBIDDEN' }, { status: 403 }) } as const
  }

  return { actorId: authData.user.id, role } as const
}

async function findAuthUserByEmail(admin: any, email: string) {
  const perPage = 1000

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) return { user: null, error }

    const users = Array.isArray(data?.users) ? data.users : []
    const user = users.find((candidate: any) => {
      return candidate.email && String(candidate.email).toLowerCase() === email
    }) ?? null

    if (user) return { user, error: null }
    if (users.length < perPage) break
  }

  return { user: null, error: null }
}

function revalidateFamilyViews() {
  try {
    revalidateTag('members')
  } catch {}
  try {
    revalidatePath('/admin/members/families')
  } catch {}
  try {
    revalidatePath('/admin/members')
  } catch {}
  try {
    revalidatePath('/members')
  } catch {}
  try {
    revalidatePath('/family')
  } catch {}
}

export async function POST(req: Request) {
  const actor = await requireAdminActor()
  if ('error' in actor) return actor.error

  let body: ActionBody
  try {
    body = (await req.json()) as ActionBody
  } catch {
    return noStore({ ok: false, error: 'INVALID_BODY' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const action = String(body?.action ?? '')

  if (action === 'create') {
    const familyName = normalizeFamilyName((body as any)?.familyName)

    if (familyName.length < 2 || familyName.length > 120) {
      return noStore({ ok: false, error: 'INVALID_FAMILY_NAME' }, { status: 400 })
    }

    const { data, error } = await admin
      .from('families')
      .insert({ name: familyName, created_by: actor.actorId })
      .select('id,name,created_at')
      .single()

    if (error) {
      return noStore(
        { ok: false, error: 'CREATE_FAMILY_FAILED', details: error.message },
        { status: 500 },
      )
    }

    revalidateFamilyViews()
    return noStore({ ok: true, family: data })
  }

  if (action === 'rename_family') {
    const familyId = String((body as any)?.familyId ?? '').trim()
    const familyName = normalizeFamilyName((body as any)?.familyName)

    if (!UUID_RE.test(familyId)) {
      return noStore({ ok: false, error: 'INVALID_FAMILY_ID' }, { status: 400 })
    }
    if (familyName.length < 2 || familyName.length > 120) {
      return noStore({ ok: false, error: 'INVALID_FAMILY_NAME' }, { status: 400 })
    }

    const { data, error } = await admin
      .from('families')
      .update({ name: familyName })
      .eq('id', familyId)
      .select('id,name,created_at')
      .maybeSingle()

    if (error) {
      return noStore(
        { ok: false, error: 'RENAME_FAMILY_FAILED', details: error.message },
        { status: 500 },
      )
    }
    if (!data) {
      return noStore({ ok: false, error: 'FAMILY_NOT_FOUND' }, { status: 404 })
    }

    revalidateFamilyViews()
    return noStore({ ok: true, family: data })
  }

  if (action === 'delete_family') {
    if (actor.role !== 'super_admin') {
      return noStore({ ok: false, error: 'SUPER_ADMIN_REQUIRED' }, { status: 403 })
    }

    const familyId = String((body as any)?.familyId ?? '').trim()
    if (!UUID_RE.test(familyId)) {
      return noStore({ ok: false, error: 'INVALID_FAMILY_ID' }, { status: 400 })
    }

    const [{ data: family, error: familyError }, { count: memberCount, error: memberCountError }, { count: guardianCount, error: guardianCountError }] = await Promise.all([
      admin.from('families').select('id,name').eq('id', familyId).maybeSingle(),
      admin.from('family_members').select('member_id', { count: 'exact', head: true }).eq('family_id', familyId),
      admin.from('family_guardians').select('auth_user_id', { count: 'exact', head: true }).eq('family_id', familyId),
    ])

    if (familyError || !family) {
      return noStore(
        { ok: false, error: 'FAMILY_NOT_FOUND', details: familyError?.message ?? null },
        { status: 404 },
      )
    }
    if (memberCountError || guardianCountError) {
      return noStore(
        {
          ok: false,
          error: 'FAMILY_DELETE_CHECK_FAILED',
          details: memberCountError?.message ?? guardianCountError?.message ?? null,
        },
        { status: 500 },
      )
    }

    if (Number(memberCount ?? 0) > 0) {
      return noStore(
        {
          ok: false,
          error: 'FAMILY_HAS_MEMBERS',
          details: 'Remove all member links before deleting the family. Member profiles are never deleted with a family.',
          member_count: Number(memberCount ?? 0),
        },
        { status: 409 },
      )
    }

    const { error: deleteError } = await admin.from('families').delete().eq('id', familyId)
    if (deleteError) {
      return noStore(
        { ok: false, error: 'DELETE_FAMILY_FAILED', details: deleteError.message },
        { status: 500 },
      )
    }

    revalidateFamilyViews()
    return noStore({
      ok: true,
      guardian_links_removed: Number(guardianCount ?? 0),
      auth_accounts_deleted: false,
      message: 'Family deleted. Guardian links were removed, while Auth accounts and member profiles were preserved.',
    })
  }

  if (action === 'link_member') {
    const familyId = String((body as any)?.familyId ?? '').trim()
    const memberId = String((body as any)?.memberId ?? '').trim()

    if (!UUID_RE.test(familyId) || !UUID_RE.test(memberId)) {
      return noStore({ ok: false, error: 'INVALID_ID' }, { status: 400 })
    }

    const [{ data: family, error: familyError }, { data: member, error: memberError }] = await Promise.all([
      admin.from('families').select('id,name').eq('id', familyId).maybeSingle(),
      admin.from('profiles').select('user_id,first_name,last_name,member_id,role').eq('user_id', memberId).maybeSingle(),
    ])

    if (familyError || !family) {
      return noStore(
        { ok: false, error: 'FAMILY_NOT_FOUND', details: familyError?.message ?? null },
        { status: 404 },
      )
    }

    if (memberError || !member) {
      return noStore(
        { ok: false, error: 'MEMBER_NOT_FOUND', details: memberError?.message ?? null },
        { status: 404 },
      )
    }

    const memberRole = normalizeRole(member.role)
    if (!(MEMBER_LIKE_ROLES as readonly string[]).includes(memberRole)) {
      return noStore({ ok: false, error: 'PROFILE_IS_NOT_A_MEMBER' }, { status: 400 })
    }

    const { data: existing, error: existingError } = await admin
      .from('family_members')
      .select('family_id')
      .eq('member_id', memberId)
      .maybeSingle()

    if (existingError) {
      return noStore(
        { ok: false, error: 'FAMILY_LINK_LOOKUP_FAILED', details: existingError.message },
        { status: 500 },
      )
    }

    if (existing?.family_id === familyId) {
      return noStore({ ok: true, alreadyLinked: true })
    }

    if (existing?.family_id) {
      const { data: currentFamily } = await admin
        .from('families')
        .select('id,name')
        .eq('id', existing.family_id)
        .maybeSingle()

      return noStore(
        {
          ok: false,
          error: 'MEMBER_ALREADY_IN_ANOTHER_FAMILY',
          currentFamily: currentFamily ?? { id: existing.family_id, name: 'Another family' },
        },
        { status: 409 },
      )
    }

    const { error: insertError } = await admin.from('family_members').insert({
      family_id: familyId,
      member_id: memberId,
      added_by: actor.actorId,
    })

    if (insertError) {
      if (insertError.code === '23505') {
        return noStore({ ok: false, error: 'MEMBER_ALREADY_IN_ANOTHER_FAMILY' }, { status: 409 })
      }

      return noStore(
        { ok: false, error: 'LINK_MEMBER_FAILED', details: insertError.message },
        { status: 500 },
      )
    }

    revalidateFamilyViews()
    return noStore({ ok: true })
  }

  if (action === 'unlink_member') {
    const familyId = String((body as any)?.familyId ?? '').trim()
    const memberId = String((body as any)?.memberId ?? '').trim()

    if (!UUID_RE.test(familyId) || !UUID_RE.test(memberId)) {
      return noStore({ ok: false, error: 'INVALID_ID' }, { status: 400 })
    }

    const { error } = await admin
      .from('family_members')
      .delete()
      .eq('family_id', familyId)
      .eq('member_id', memberId)

    if (error) {
      return noStore(
        { ok: false, error: 'UNLINK_MEMBER_FAILED', details: error.message },
        { status: 500 },
      )
    }

    revalidateFamilyViews()
    return noStore({ ok: true })
  }

  if (action === 'create_parent_account' || action === 'create_guardian_account') {
    const familyId = String((body as any)?.familyId ?? '').trim()
    const email = normalizeEmail((body as any)?.email)
    const firstName = normalizeText((body as any)?.firstName)
    const lastName = normalizeText((body as any)?.lastName)
    const phone = normalizeText((body as any)?.phone) || null
    const legacyPrimaryOnly = action === 'create_parent_account'

    if (!UUID_RE.test(familyId)) {
      return noStore({ ok: false, error: 'INVALID_FAMILY_ID' }, { status: 400 })
    }
    if (!EMAIL_RE.test(email) || email.length > 320) {
      return noStore({ ok: false, error: 'INVALID_GUARDIAN_EMAIL' }, { status: 400 })
    }
    if (!firstName || firstName.length > 120 || lastName.length > 120) {
      return noStore({ ok: false, error: 'INVALID_GUARDIAN_NAME' }, { status: 400 })
    }

    const [{ data: family, error: familyError }, { data: existingPrimary, error: primaryError }] = await Promise.all([
      admin.from('families').select('id,name').eq('id', familyId).maybeSingle(),
      admin
        .from('family_guardians')
        .select('auth_user_id,email,first_name,last_name')
        .eq('family_id', familyId)
        .eq('is_primary', true)
        .maybeSingle(),
    ])

    if (familyError || !family) {
      return noStore(
        { ok: false, error: 'FAMILY_NOT_FOUND', details: familyError?.message ?? null },
        { status: 404 },
      )
    }
    if (primaryError) {
      return noStore(
        { ok: false, error: 'GUARDIAN_LOOKUP_FAILED', details: primaryError.message },
        { status: 500 },
      )
    }
    if (legacyPrimaryOnly && existingPrimary?.auth_user_id) {
      return noStore(
        {
          ok: false,
          error: 'PRIMARY_PARENT_ALREADY_EXISTS',
          parent: existingPrimary,
        },
        { status: 409 },
      )
    }

    const { user: existingAuthUser, error: authLookupError } = await findAuthUserByEmail(admin, email)
    if (authLookupError) {
      return noStore(
        { ok: false, error: 'AUTH_LOOKUP_FAILED', details: authLookupError.message },
        { status: 500 },
      )
    }

    if (existingAuthUser?.id) {
      const { data: existingGuardian, error: guardianLookupError } = await admin
        .from('family_guardians')
        .select('auth_user_id,is_primary')
        .eq('family_id', familyId)
        .eq('auth_user_id', existingAuthUser.id)
        .maybeSingle()

      if (guardianLookupError) {
        return noStore(
          { ok: false, error: 'GUARDIAN_LINK_LOOKUP_FAILED', details: guardianLookupError.message },
          { status: 500 },
        )
      }
      if (existingGuardian?.auth_user_id) {
        return noStore(
          { ok: false, error: 'GUARDIAN_ALREADY_LINKED', guardian: existingGuardian },
          { status: 409 },
        )
      }
    }

    let authUserId = existingAuthUser?.id ?? null
    let existingAccount = Boolean(existingAuthUser?.id)
    let inviteSent = false
    let inviteMode: 'existing_account' | 'custom_email' | 'supabase_default' | 'none' = existingAccount
      ? 'existing_account'
      : 'none'
    let inviteWarning: string | null = null
    let createdNewAuthUser = false
    const isPrimary = !existingPrimary?.auth_user_id

    const appUrl = (
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      'http://localhost:3000'
    ).replace(/\/$/, '')
    const redirectTo = `${appUrl}/auth/complete-invite?next=%2Ffamily`
    const authMetadata = {
      account_type: isPrimary ? 'family_parent' : 'family_guardian',
      family_id: familyId,
      first_name: firstName,
      last_name: lastName || null,
      phone,
    }

    if (!authUserId && process.env.RESEND_API_KEY) {
      const { data: linkData, error: linkError } = await (admin.auth.admin as any).generateLink({
        type: 'invite',
        email,
        redirectTo,
        data: authMetadata,
      })

      if (!linkError) {
        authUserId = linkData?.user?.id ?? null
        const actionLink = extractActionLink(linkData)

        if (authUserId && actionLink) {
          createdNewAuthUser = true
          const customEmail = await sendFamilyParentInviteEmail({
            to: email,
            actionLink,
            firstName,
            lastName,
            familyName: family.name,
          })

          if (customEmail.sent) {
            inviteSent = true
            inviteMode = 'custom_email'
          } else {
            inviteWarning = customEmail.reason ?? 'CUSTOM_GUARDIAN_INVITE_FAILED'

            await admin.auth.admin.deleteUser(authUserId).catch(() => null)
            authUserId = null
            createdNewAuthUser = false
          }
        } else if (authUserId) {
          await admin.auth.admin.deleteUser(authUserId).catch(() => null)
          authUserId = null
          createdNewAuthUser = false
        }
      }
    }

    if (!authUserId) {
      const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: authMetadata,
      })

      if (inviteError || !invited?.user?.id) {
        return noStore(
          {
            ok: false,
            error: 'CREATE_GUARDIAN_AUTH_FAILED',
            details: inviteError?.message ?? inviteWarning ?? 'Could not create guardian Auth account.',
          },
          { status: 500 },
        )
      }

      authUserId = invited.user.id
      createdNewAuthUser = true
      existingAccount = false
      inviteSent = true
      inviteMode = 'supabase_default'
    }

    const { error: guardianInsertError } = await admin.from('family_guardians').insert({
      family_id: familyId,
      auth_user_id: authUserId,
      email,
      first_name: firstName,
      last_name: lastName || null,
      phone,
      relationship: 'parent',
      is_primary: isPrimary,
      invited_at: inviteSent ? new Date().toISOString() : null,
      created_by: actor.actorId,
    })

    if (guardianInsertError) {
      if (createdNewAuthUser) {
        await admin.auth.admin.deleteUser(authUserId).catch(() => null)
      }
      return noStore(
        { ok: false, error: 'CREATE_GUARDIAN_LINK_FAILED', details: guardianInsertError.message },
        { status: guardianInsertError.code === '23505' ? 409 : 500 },
      )
    }

    revalidateFamilyViews()
    return noStore({
      ok: true,
      guardian: {
        auth_user_id: authUserId,
        email,
        first_name: firstName,
        last_name: lastName || null,
        phone,
        is_primary: isPrimary,
      },
      parent: legacyPrimaryOnly
        ? {
            auth_user_id: authUserId,
            email,
            first_name: firstName,
            last_name: lastName || null,
            phone,
          }
        : undefined,
      is_primary: isPrimary,
      existing_account: existingAccount,
      invite_sent: inviteSent,
      invite_mode: inviteMode,
      invite_warning: inviteWarning,
      message: existingAccount
        ? `Existing ATOM account linked as ${isPrimary ? 'primary guardian' : 'guardian'}. No duplicate account was created.`
        : `${isPrimary ? 'Primary guardian' : 'Guardian'} account created and invitation sent.`,
    })
  }

  if (action === 'update_guardian') {
    const familyId = String((body as any)?.familyId ?? '').trim()
    const authUserId = String((body as any)?.authUserId ?? '').trim()
    const firstName = normalizeText((body as any)?.firstName)
    const lastName = normalizeText((body as any)?.lastName)
    const phone = normalizeText((body as any)?.phone) || null

    if (!UUID_RE.test(familyId) || !UUID_RE.test(authUserId)) {
      return noStore({ ok: false, error: 'INVALID_ID' }, { status: 400 })
    }
    if (!firstName || firstName.length > 120 || lastName.length > 120 || (phone && phone.length > 80)) {
      return noStore({ ok: false, error: 'INVALID_GUARDIAN_DETAILS' }, { status: 400 })
    }

    const { data, error } = await admin
      .from('family_guardians')
      .update({
        first_name: firstName,
        last_name: lastName || null,
        phone,
      })
      .eq('family_id', familyId)
      .eq('auth_user_id', authUserId)
      .select('family_id,auth_user_id,email,first_name,last_name,phone,is_primary,invited_at,created_at')
      .maybeSingle()

    if (error) {
      return noStore(
        { ok: false, error: 'UPDATE_GUARDIAN_FAILED', details: error.message },
        { status: 500 },
      )
    }
    if (!data) {
      return noStore({ ok: false, error: 'GUARDIAN_NOT_FOUND' }, { status: 404 })
    }

    revalidateFamilyViews()
    return noStore({
      ok: true,
      guardian: data,
      message: 'Guardian details updated. Login email and Auth account were not changed.',
    })
  }


  if (action === 'promote_guardian_to_member') {
    const familyId = String((body as any)?.familyId ?? '').trim()
    const authUserId = String((body as any)?.authUserId ?? '').trim()

    if (!UUID_RE.test(familyId) || !UUID_RE.test(authUserId)) {
      return noStore({ ok: false, error: 'INVALID_ID' }, { status: 400 })
    }

    const { data, error } = await admin.rpc('family_guardian_promote_to_member', {
      p_family_id: familyId,
      p_auth_user_id: authUserId,
      p_added_by: actor.actorId,
    })

    if (error) {
      const message = String(error.message ?? '')
      const status =
        message.includes('GUARDIAN_NOT_FOUND') ? 404 :
        message.includes('GUARDIAN_ALREADY_HAS_PROFILE') ||
        message.includes('GUARDIAN_EMAIL_ALREADY_USED_BY_MEMBER_PROFILE') ? 409 :
        500

      return noStore(
        {
          ok: false,
          error:
            message.includes('GUARDIAN_NOT_FOUND') ? 'GUARDIAN_NOT_FOUND' :
            message.includes('GUARDIAN_ALREADY_HAS_PROFILE') ? 'GUARDIAN_ALREADY_HAS_PROFILE' :
            message.includes('GUARDIAN_EMAIL_ALREADY_USED_BY_MEMBER_PROFILE') ? 'GUARDIAN_EMAIL_ALREADY_USED_BY_MEMBER_PROFILE' :
            'PROMOTE_GUARDIAN_TO_MEMBER_FAILED',
          details: error.message,
        },
        { status },
      )
    }

    revalidateFamilyViews()
    return noStore({
      ok: true,
      member: data,
      auth_account_created: false,
      auth_account_preserved: true,
      guardian_link_preserved: true,
      message: 'Guardian promoted to ATOM member using the existing login and email.',
    })
  }

  if (action === 'preview_guardian_member_cleanup' || action === 'remove_guardian_member_profile') {
    if (actor.role !== 'super_admin') {
      return noStore({ ok: false, error: 'SUPER_ADMIN_REQUIRED' }, { status: 403 })
    }

    const familyId = String((body as any)?.familyId ?? '').trim()
    const authUserId = String((body as any)?.authUserId ?? '').trim()
    if (!UUID_RE.test(familyId) || !UUID_RE.test(authUserId)) {
      return noStore({ ok: false, error: 'INVALID_ID' }, { status: 400 })
    }

    const { data: guardian, error: guardianError } = await admin
      .from('family_guardians')
      .select('family_id,auth_user_id,email,first_name,last_name,is_primary')
      .eq('family_id', familyId)
      .eq('auth_user_id', authUserId)
      .maybeSingle()

    if (guardianError) {
      return noStore(
        { ok: false, error: 'GUARDIAN_LOOKUP_FAILED', details: guardianError.message },
        { status: 500 },
      )
    }
    if (!guardian) {
      return noStore({ ok: false, error: 'GUARDIAN_NOT_FOUND' }, { status: 404 })
    }

    if (action === 'preview_guardian_member_cleanup') {
      const { data, error } = await admin.rpc('family_guardian_member_cleanup_preview', {
        p_auth_user_id: authUserId,
      })
      if (error) {
        return noStore(
          { ok: false, error: 'MEMBER_CLEANUP_PREVIEW_FAILED', details: error.message },
          { status: 500 },
        )
      }
      return noStore({ ok: true, preview: data })
    }

    const { data, error } = await admin.rpc('family_guardian_remove_unused_member_profile', {
      p_auth_user_id: authUserId,
    })
    if (error) {
      return noStore(
        { ok: false, error: 'MEMBER_PROFILE_CLEANUP_BLOCKED', details: error.message },
        { status: 409 },
      )
    }

    revalidateFamilyViews()
    return noStore({
      ok: true,
      result: data,
      message: 'Unnecessary member profile removed. Guardian login and family access were preserved.',
    })
  }

  if (action === 'set_primary_guardian') {
    const familyId = String((body as any)?.familyId ?? '').trim()
    const authUserId = String((body as any)?.authUserId ?? '').trim()

    if (!UUID_RE.test(familyId) || !UUID_RE.test(authUserId)) {
      return noStore({ ok: false, error: 'INVALID_ID' }, { status: 400 })
    }

    const { data: target, error: targetError } = await admin
      .from('family_guardians')
      .select('auth_user_id,is_primary')
      .eq('family_id', familyId)
      .eq('auth_user_id', authUserId)
      .maybeSingle()

    if (targetError) {
      return noStore(
        { ok: false, error: 'GUARDIAN_LOOKUP_FAILED', details: targetError.message },
        { status: 500 },
      )
    }
    if (!target) {
      return noStore({ ok: false, error: 'GUARDIAN_NOT_FOUND' }, { status: 404 })
    }
    if (target.is_primary) {
      return noStore({ ok: true, already_primary: true })
    }

    const { error: primaryError } = await admin.rpc('set_family_primary_guardian', {
      p_family_id: familyId,
      p_auth_user_id: authUserId,
    })

    if (primaryError) {
      return noStore(
        { ok: false, error: 'SET_PRIMARY_GUARDIAN_FAILED', details: primaryError.message },
        { status: 500 },
      )
    }

    revalidateFamilyViews()
    return noStore({ ok: true })
  }

  if (action === 'remove_guardian') {
    const familyId = String((body as any)?.familyId ?? '').trim()
    const authUserId = String((body as any)?.authUserId ?? '').trim()

    if (!UUID_RE.test(familyId) || !UUID_RE.test(authUserId)) {
      return noStore({ ok: false, error: 'INVALID_ID' }, { status: 400 })
    }

    const { data: target, error: targetError } = await admin
      .from('family_guardians')
      .select('auth_user_id,email,is_primary')
      .eq('family_id', familyId)
      .eq('auth_user_id', authUserId)
      .maybeSingle()

    if (targetError) {
      return noStore(
        { ok: false, error: 'GUARDIAN_LOOKUP_FAILED', details: targetError.message },
        { status: 500 },
      )
    }
    if (!target) {
      return noStore({ ok: false, error: 'GUARDIAN_NOT_FOUND' }, { status: 404 })
    }
    if (target.is_primary) {
      return noStore(
        {
          ok: false,
          error: 'PRIMARY_GUARDIAN_CANNOT_BE_REMOVED',
          details: 'Set another guardian as primary before removing this account.',
        },
        { status: 409 },
      )
    }

    const { error: deleteError } = await admin
      .from('family_guardians')
      .delete()
      .eq('family_id', familyId)
      .eq('auth_user_id', authUserId)

    if (deleteError) {
      return noStore(
        { ok: false, error: 'REMOVE_GUARDIAN_FAILED', details: deleteError.message },
        { status: 500 },
      )
    }

    revalidateFamilyViews()
    return noStore({
      ok: true,
      auth_account_deleted: false,
      message: 'Guardian link removed. The Auth account and all member data remain unchanged.',
    })
  }

  if (action === 'create_dependent_member') {
    const familyId = String((body as any)?.familyId ?? '').trim()
    const firstName = normalizeText((body as any)?.firstName)
    const lastName = normalizeText((body as any)?.lastName)
    const phone = normalizeText((body as any)?.phone) || null
    const dateOfBirth = normalizeText((body as any)?.dateOfBirth) || null

    if (!UUID_RE.test(familyId)) {
      return noStore({ ok: false, error: 'INVALID_FAMILY_ID' }, { status: 400 })
    }
    if (!firstName || firstName.length > 120 || !lastName || lastName.length > 120) {
      return noStore({ ok: false, error: 'INVALID_MEMBER_NAME' }, { status: 400 })
    }
    if (dateOfBirth) {
      if (!isValidDateOnly(dateOfBirth)) {
        return noStore({ ok: false, error: 'INVALID_DATE_OF_BIRTH' }, { status: 400 })
      }
      if (dateOfBirth > todayUtcDateOnly()) {
        return noStore({ ok: false, error: 'DATE_OF_BIRTH_IN_FUTURE' }, { status: 400 })
      }
    }

    const { data: family, error: familyError } = await admin
      .from('families')
      .select('id,name')
      .eq('id', familyId)
      .maybeSingle()

    if (familyError || !family) {
      return noStore(
        { ok: false, error: 'FAMILY_NOT_FOUND', details: familyError?.message ?? null },
        { status: 404 },
      )
    }

    const memberUuid = randomUUID()
    const { data: member, error: memberError } = await admin
      .from('profiles')
      .insert({
        user_id: memberUuid,
        email: null,
        first_name: firstName,
        last_name: lastName,
        phone,
        date_of_birth: dateOfBirth,
        role: 'member',
        qr_code: `atom:${memberUuid}`,
      })
      .select('user_id,member_id,email,first_name,last_name,phone,date_of_birth,qr_code')
      .single()

    if (memberError || !member) {
      return noStore(
        { ok: false, error: 'CREATE_DEPENDENT_MEMBER_FAILED', details: memberError?.message ?? null },
        { status: 500 },
      )
    }

    const { error: linkError } = await admin.from('family_members').insert({
      family_id: familyId,
      member_id: memberUuid,
      added_by: actor.actorId,
    })

    if (linkError) {
      await admin.from('profiles').delete().eq('user_id', memberUuid)
      return noStore(
        { ok: false, error: 'LINK_DEPENDENT_MEMBER_FAILED', details: linkError.message },
        { status: 500 },
      )
    }

    revalidateFamilyViews()
    return noStore({
      ok: true,
      member,
      family: { id: family.id, name: family.name },
      auth_account_created: false,
      email_required: false,
      message: 'Family member created without a separate login/email and linked to the family.',
    })
  }

  return noStore({ ok: false, error: 'UNKNOWN_ACTION' }, { status: 400 })
}
