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

  if (action === 'create_parent_account') {
    const familyId = String((body as any)?.familyId ?? '').trim()
    const email = normalizeEmail((body as any)?.email)
    const firstName = normalizeText((body as any)?.firstName)
    const lastName = normalizeText((body as any)?.lastName)
    const phone = normalizeText((body as any)?.phone) || null

    if (!UUID_RE.test(familyId)) {
      return noStore({ ok: false, error: 'INVALID_FAMILY_ID' }, { status: 400 })
    }
    if (!EMAIL_RE.test(email) || email.length > 320) {
      return noStore({ ok: false, error: 'INVALID_PARENT_EMAIL' }, { status: 400 })
    }
    if (!firstName || firstName.length > 120 || lastName.length > 120) {
      return noStore({ ok: false, error: 'INVALID_PARENT_NAME' }, { status: 400 })
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
        { ok: false, error: 'PARENT_LOOKUP_FAILED', details: primaryError.message },
        { status: 500 },
      )
    }
    if (existingPrimary?.auth_user_id) {
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

    let authUserId = existingAuthUser?.id ?? null
    let existingAccount = Boolean(existingAuthUser?.id)
    let inviteSent = false
    let inviteMode: 'existing_account' | 'custom_email' | 'supabase_default' | 'none' = existingAccount
      ? 'existing_account'
      : 'none'
    let inviteWarning: string | null = null
    let createdNewAuthUser = false

    const appUrl = (
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      'http://localhost:3000'
    ).replace(/\/$/, '')
    const redirectTo = `${appUrl}/auth/complete-invite?next=%2Ffamily`
    const authMetadata = {
      account_type: 'family_parent',
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
            inviteWarning = customEmail.reason ?? 'CUSTOM_PARENT_INVITE_FAILED'

            // Remove the generated-but-unsent account so the normal Supabase
            // invite can safely recreate it and send its standard email.
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
            error: 'CREATE_PARENT_AUTH_FAILED',
            details: inviteError?.message ?? inviteWarning ?? 'Could not create parent Auth account.',
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
      is_primary: true,
      invited_at: inviteSent ? new Date().toISOString() : null,
      created_by: actor.actorId,
    })

    if (guardianInsertError) {
      if (createdNewAuthUser) {
        await admin.auth.admin.deleteUser(authUserId).catch(() => null)
      }
      return noStore(
        { ok: false, error: 'CREATE_PARENT_LINK_FAILED', details: guardianInsertError.message },
        { status: guardianInsertError.code === '23505' ? 409 : 500 },
      )
    }

    revalidateFamilyViews()
    return noStore({
      ok: true,
      parent: {
        auth_user_id: authUserId,
        email,
        first_name: firstName,
        last_name: lastName || null,
        phone,
      },
      existing_account: existingAccount,
      invite_sent: inviteSent,
      invite_mode: inviteMode,
      invite_warning: inviteWarning,
      message: existingAccount
        ? 'Existing ATOM account linked as the family parent. No duplicate account was created.'
        : 'Parent account created and invitation sent.',
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
