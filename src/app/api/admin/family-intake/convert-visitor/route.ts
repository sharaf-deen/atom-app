export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { canAccessFamilyIntake, normalizeRole } from '@/lib/rbac'
import { extractActionLink, sendFamilyParentInviteEmail } from '@/lib/memberInviteEmail'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

type Body = {
  visitorTrialId?: string
  guardianEmail?: string
  familyName?: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function noStore(body: any, init?: ResponseInit) {
  const response = NextResponse.json(body, init)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function text(value: unknown, max = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function normalizeEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase().slice(0, 320)
}

async function requireFrontDeskActor() {
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
    return { error: noStore({ ok: false, error: 'ACTOR_PROFILE_ERROR', details: profileError.message }, { status: 500 }) } as const
  }

  const role = normalizeRole(profile?.role)
  if (!canAccessFamilyIntake(role)) {
    return { error: noStore({ ok: false, error: 'FORBIDDEN' }, { status: 403 }) } as const
  }

  return { actorId: authData.user.id, role } as const
}

async function findAuthUserByEmail(admin: any, targetEmail: string) {
  if (!targetEmail) return { user: null, error: null }
  const perPage = 1000

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) return { user: null, error }

    const users = Array.isArray(data?.users) ? data.users : []
    const user = users.find(
      (candidate: any) => String(candidate?.email ?? '').trim().toLowerCase() === targetEmail,
    ) ?? null

    if (user) return { user, error: null }
    if (users.length < perPage) break
  }

  return { user: null, error: null }
}

function revalidateFamilyViews(memberUserId?: string | null) {
  for (const path of [
    '/admin/visitors',
    '/admin/members/family-intake',
    '/admin/members/families',
    '/members',
    '/admin/members',
  ]) {
    try { revalidatePath(path) } catch {}
  }
  if (memberUserId) {
    try { revalidatePath(`/members/${memberUserId}`) } catch {}
  }
  try { revalidateTag('members') } catch {}
}

export async function POST(req: Request) {
  const actor = await requireFrontDeskActor()
  if ('error' in actor) return actor.error

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return noStore({ ok: false, error: 'INVALID_BODY' }, { status: 400 })
  }

  const visitorTrialId = text(body.visitorTrialId, 80)
  const requestedGuardianEmail = normalizeEmail(body.guardianEmail)
  const requestedFamilyName = text(body.familyName, 120)

  if (!UUID_RE.test(visitorTrialId)) {
    return noStore({ ok: false, error: 'INVALID_VISITOR_TRIAL_ID' }, { status: 400 })
  }
  if (requestedGuardianEmail && !EMAIL_RE.test(requestedGuardianEmail)) {
    return noStore({ ok: false, error: 'INVALID_GUARDIAN_EMAIL' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  let createdFamilyId: string | null = null
  let createdAuthUserId: string | null = null
  let createdGuardianLink: { familyId: string; authUserId: string } | null = null
  let conversionCommitted = false
  let pendingCustomInvite:
    | {
        actionLink: string
        email: string
        firstName: string
        lastName: string
        familyName: string
      }
    | null = null

  try {
    const { data: visitor, error: visitorError } = await admin
      .from('visitor_trials')
      .select('id,first_name,last_name,phone,email,date_of_birth,trial_date,linked_member_id,family_intake_id')
      .eq('id', visitorTrialId)
      .maybeSingle()

    if (visitorError) throw new Error(`VISITOR_LOOKUP_FAILED: ${visitorError.message}`)
    if (!visitor) return noStore({ ok: false, error: 'VISITOR_NOT_FOUND' }, { status: 404 })

    if (!visitor.family_intake_id) {
      return noStore(
        {
          ok: false,
          error: 'VISITOR_NOT_IN_FAMILY_INTAKE',
          details: 'Attach the Visitor through Family Intake → Link existing Visitor before converting.',
        },
        { status: 409 },
      )
    }

    if (visitor.linked_member_id) {
      const { data: linkedProfile } = await admin
        .from('profiles')
        .select('user_id,member_id,first_name,last_name')
        .eq('user_id', visitor.linked_member_id)
        .maybeSingle()

      const { data: familyLink } = await admin
        .from('family_members')
        .select('family_id')
        .eq('member_id', visitor.linked_member_id)
        .maybeSingle()

      if (familyLink?.family_id) {
        const { data: family } = await admin
          .from('families')
          .select('id,name')
          .eq('id', familyLink.family_id)
          .maybeSingle()

        revalidateFamilyViews(visitor.linked_member_id)
        return noStore({
          ok: true,
          already_converted: true,
          member_user_id: visitor.linked_member_id,
          member_id: linkedProfile?.member_id ?? null,
          family_id: familyLink.family_id,
          family_name: family?.name ?? 'Family',
          guardian_auth_user_id: null,
          guardian_account_created: false,
          guardian_invite_sent: false,
          guardian_invite_warning: null,
          message: 'Visitor was already linked to a family Member. No duplicate was created.',
        })
      }

      return noStore(
        {
          ok: false,
          error: 'VISITOR_ALREADY_LINKED_TO_MEMBER',
          details: 'The Visitor is already linked to a Member that is not safely linked through this Family Intake.',
        },
        { status: 409 },
      )
    }

    const { data: intake, error: intakeError } = await admin
      .from('family_intakes')
      .select('id,guardian_first_name,guardian_last_name,guardian_phone,guardian_email,guardian_relationship,guardian_auth_user_id,family_id,status')
      .eq('id', visitor.family_intake_id)
      .maybeSingle()

    if (intakeError) throw new Error(`FAMILY_INTAKE_LOOKUP_FAILED: ${intakeError.message}`)
    if (!intake) throw new Error('FAMILY_INTAKE_NOT_FOUND')

    const { data: intakeChild, error: intakeChildError } = await admin
      .from('family_intake_children')
      .select('id,child_kind,visitor_trial_id,member_id')
      .eq('intake_id', intake.id)
      .eq('visitor_trial_id', visitor.id)
      .maybeSingle()

    if (intakeChildError) throw new Error(`INTAKE_CHILD_LOOKUP_FAILED: ${intakeChildError.message}`)
    if (!intakeChild) throw new Error('FAMILY_INTAKE_CHILD_NOT_FOUND')

    if (intakeChild.member_id) {
      const { data: member } = await admin
        .from('profiles')
        .select('user_id,member_id')
        .eq('user_id', intakeChild.member_id)
        .maybeSingle()
      const { data: familyLink } = await admin
        .from('family_members')
        .select('family_id')
        .eq('member_id', intakeChild.member_id)
        .maybeSingle()
      if (member && familyLink?.family_id) {
        const { data: family } = await admin.from('families').select('id,name').eq('id', familyLink.family_id).maybeSingle()
        return noStore({
          ok: true,
          already_converted: true,
          member_user_id: member.user_id,
          member_id: member.member_id,
          family_id: familyLink.family_id,
          family_name: family?.name ?? 'Family',
          guardian_auth_user_id: intake.guardian_auth_user_id ?? null,
          guardian_account_created: false,
          guardian_invite_sent: false,
          guardian_invite_warning: null,
          message: 'This Family Intake child was already converted. No duplicate was created.',
        })
      }
      throw new Error('INTAKE_CHILD_CONVERSION_CONFLICT')
    }

    let familyId = intake.family_id ? String(intake.family_id) : null
    let guardianAuthUserId = intake.guardian_auth_user_id ? String(intake.guardian_auth_user_id) : null
    let guardianEmail = requestedGuardianEmail || normalizeEmail(intake.guardian_email)
    const guardianFirstName = text(intake.guardian_first_name) || 'Guardian'
    const guardianLastName = text(intake.guardian_last_name)
    const guardianPhone = text(intake.guardian_phone, 40)
    const guardianRelationship = ['father', 'mother', 'parent', 'guardian', 'other'].includes(String(intake.guardian_relationship))
      ? String(intake.guardian_relationship)
      : 'parent'

    // Existing family is authoritative. Recover its primary guardian if the intake
    // did not persist the Auth user id for any reason.
    if (familyId && !guardianAuthUserId) {
      const { data: familyGuardians, error } = await admin
        .from('family_guardians')
        .select('auth_user_id,email,first_name,last_name,phone,is_primary')
        .eq('family_id', familyId)
        .order('is_primary', { ascending: false })
        .limit(2)
      if (error) throw new Error(`FAMILY_GUARDIAN_LOOKUP_FAILED: ${error.message}`)
      if (familyGuardians?.[0]) {
        guardianAuthUserId = String(familyGuardians[0].auth_user_id)
        guardianEmail = guardianEmail || normalizeEmail(familyGuardians[0].email)
      }
    }

    // Before creating anything, reuse an existing guardian/family by Auth id.
    if (!familyId && guardianAuthUserId) {
      const { data: links, error } = await admin
        .from('family_guardians')
        .select('family_id,auth_user_id,email')
        .eq('auth_user_id', guardianAuthUserId)
        .limit(2)
      if (error) throw new Error(`GUARDIAN_LINK_LOOKUP_FAILED: ${error.message}`)
      if ((links ?? []).length > 1) throw new Error('GUARDIAN_LINK_AMBIGUOUS')
      if (links?.[0]) {
        familyId = String(links[0].family_id)
        guardianEmail = guardianEmail || normalizeEmail(links[0].email)
      }
    }

    // Reuse an existing guardian by email before creating a new Family.
    if (!familyId && guardianEmail) {
      const { data: exactGuardians, error } = await admin
        .from('family_guardians')
        .select('family_id,auth_user_id,email')
        .ilike('email', guardianEmail)
        .limit(2)
      if (error) throw new Error(`GUARDIAN_LOOKUP_FAILED: ${error.message}`)
      if ((exactGuardians ?? []).length > 1) throw new Error('GUARDIAN_LINK_AMBIGUOUS')
      if (exactGuardians?.[0]) {
        if (guardianAuthUserId && String(exactGuardians[0].auth_user_id) !== guardianAuthUserId) {
          throw new Error('GUARDIAN_EMAIL_CONFLICT')
        }
        guardianAuthUserId = String(exactGuardians[0].auth_user_id)
        familyId = String(exactGuardians[0].family_id)
      }
    }

    // Resolve the Auth account if the intake has no existing guardian account.
    if (!guardianAuthUserId) {
      if (!guardianEmail) {
        return noStore({ ok: false, error: 'GUARDIAN_EMAIL_REQUIRED' }, { status: 400 })
      }

      const { user: existingAuthUser, error: authLookupError } = await findAuthUserByEmail(admin, guardianEmail)
      if (authLookupError) throw new Error(`AUTH_LOOKUP_FAILED: ${authLookupError.message}`)
      if (existingAuthUser?.id) guardianAuthUserId = String(existingAuthUser.id)
    } else {
      const authById = await (admin.auth.admin as any).getUserById(guardianAuthUserId)
      if (authById?.error) throw new Error(`AUTH_USER_LOOKUP_FAILED: ${authById.error.message}`)
      const authEmail = normalizeEmail(authById?.data?.user?.email)
      if (guardianEmail && authEmail && guardianEmail !== authEmail) {
        throw new Error('GUARDIAN_EMAIL_CONFLICT')
      }
      guardianEmail = authEmail || guardianEmail
    }

    // A resolved Auth account may itself already be a guardian. Reuse that Family.
    if (!familyId && guardianAuthUserId) {
      const { data: links, error } = await admin
        .from('family_guardians')
        .select('family_id,auth_user_id,email')
        .eq('auth_user_id', guardianAuthUserId)
        .limit(2)
      if (error) throw new Error(`GUARDIAN_LINK_LOOKUP_FAILED: ${error.message}`)
      if ((links ?? []).length > 1) throw new Error('GUARDIAN_LINK_AMBIGUOUS')
      if (links?.[0]) {
        familyId = String(links[0].family_id)
        guardianEmail = guardianEmail || normalizeEmail(links[0].email)
      }
    }

    const fallbackFamilyName = `${guardianLastName || guardianFirstName} Family`.trim()
    const familyName = requestedFamilyName || fallbackFamilyName

    if (!familyId) {
      const { data: family, error: familyError } = await admin
        .from('families')
        .insert({ name: familyName, created_by: actor.actorId })
        .select('id,name')
        .single()
      if (familyError || !family) throw new Error(`CREATE_FAMILY_FAILED: ${familyError?.message ?? 'Unknown error'}`)
      familyId = String(family.id)
      createdFamilyId = familyId
    }

    if (!guardianAuthUserId) {
      if (!guardianEmail) {
        return noStore({ ok: false, error: 'GUARDIAN_EMAIL_REQUIRED' }, { status: 400 })
      }

      const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
      const redirectTo = `${appUrl}/auth/complete-invite?next=%2Ffamily`
      const metadata = {
        account_type: 'family_parent',
        family_id: familyId,
        first_name: guardianFirstName,
        last_name: guardianLastName || null,
        phone: guardianPhone || null,
      }

      if (process.env.RESEND_API_KEY) {
        const { data: linkData, error: linkError } = await (admin.auth.admin as any).generateLink({
          type: 'invite',
          email: guardianEmail,
          redirectTo,
          data: metadata,
        })

        if (!linkError && linkData?.user?.id) {
          const actionLink = extractActionLink(linkData)
          if (actionLink) {
            guardianAuthUserId = String(linkData.user.id)
            createdAuthUserId = guardianAuthUserId
            pendingCustomInvite = {
              actionLink,
              email: guardianEmail,
              firstName: guardianFirstName,
              lastName: guardianLastName,
              familyName,
            }
          } else {
            await admin.auth.admin.deleteUser(linkData.user.id).catch(() => null)
          }
        }
      }

      if (!guardianAuthUserId) {
        const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(guardianEmail, {
          redirectTo,
          data: metadata,
        })
        if (inviteError || !invited?.user?.id) {
          throw new Error(`CREATE_GUARDIAN_AUTH_FAILED: ${inviteError?.message ?? 'Could not invite guardian'}`)
        }
        guardianAuthUserId = String(invited.user.id)
        createdAuthUserId = guardianAuthUserId
      }
    }

    // Never attach the same guardian Auth account to a second Family silently.
    const { data: guardianLinks, error: guardianLinksError } = await admin
      .from('family_guardians')
      .select('family_id,auth_user_id')
      .eq('auth_user_id', guardianAuthUserId)
      .limit(2)
    if (guardianLinksError) throw new Error(`GUARDIAN_LINK_LOOKUP_FAILED: ${guardianLinksError.message}`)
    if ((guardianLinks ?? []).some((link: any) => String(link.family_id) !== familyId)) {
      throw new Error('GUARDIAN_ALREADY_BELONGS_TO_ANOTHER_FAMILY')
    }

    if (!(guardianLinks ?? []).some((link: any) => String(link.family_id) === familyId)) {
      const { data: primaryGuardian } = await admin
        .from('family_guardians')
        .select('auth_user_id')
        .eq('family_id', familyId)
        .eq('is_primary', true)
        .maybeSingle()

      const { error: guardianInsertError } = await admin.from('family_guardians').insert({
        family_id: familyId,
        auth_user_id: guardianAuthUserId,
        email: guardianEmail,
        first_name: guardianFirstName,
        last_name: guardianLastName || null,
        phone: guardianPhone || null,
        relationship: guardianRelationship,
        is_primary: !primaryGuardian,
        invited_at: createdAuthUserId ? new Date().toISOString() : null,
        created_by: actor.actorId,
      })
      if (guardianInsertError) throw new Error(`CREATE_GUARDIAN_LINK_FAILED: ${guardianInsertError.message}`)
      createdGuardianLink = { familyId, authUserId: guardianAuthUserId }
    }

    const { data: conversion, error: conversionError } = await admin.rpc(
      'family_convert_visitor_to_member',
      {
        p_visitor_trial_id: visitor.id,
        p_family_id: familyId,
        p_guardian_auth_user_id: guardianAuthUserId,
        p_guardian_email: guardianEmail || null,
        p_actor_id: actor.actorId,
      },
    )

    if (conversionError) throw new Error(`VISITOR_CONVERSION_FAILED: ${conversionError.message}`)
    conversionCommitted = true

    const memberUserId = String(conversion?.member_user_id ?? conversion?.user_id ?? '')
    if (!UUID_RE.test(memberUserId)) throw new Error('VISITOR_CONVERSION_MISSING_MEMBER_ID')

    let guardianInviteSent = Boolean(createdAuthUserId && !pendingCustomInvite)
    let guardianInviteWarning: string | null = null

    if (pendingCustomInvite) {
      try {
        const sent = await sendFamilyParentInviteEmail({
          to: pendingCustomInvite.email,
          actionLink: pendingCustomInvite.actionLink,
          firstName: pendingCustomInvite.firstName,
          lastName: pendingCustomInvite.lastName,
          familyName: pendingCustomInvite.familyName,
        })
        guardianInviteSent = sent.sent
        if (!sent.sent) guardianInviteWarning = sent.reason ?? 'CUSTOM_GUARDIAN_INVITE_FAILED'
      } catch (mailError: any) {
        guardianInviteSent = false
        guardianInviteWarning = String(mailError?.message || mailError || 'CUSTOM_GUARDIAN_INVITE_FAILED')
      }
    }

    const { data: familyRow } = await admin
      .from('families')
      .select('id,name')
      .eq('id', familyId)
      .maybeSingle()

    revalidateFamilyViews(memberUserId)

    return noStore({
      ok: true,
      already_converted: Boolean(conversion?.already_converted),
      member_user_id: memberUserId,
      member_id: conversion?.member_id ?? null,
      family_id: familyId,
      family_name: familyRow?.name ?? familyName,
      guardian_auth_user_id: guardianAuthUserId,
      guardian_account_created: Boolean(createdAuthUserId),
      guardian_invite_sent: guardianInviteSent,
      guardian_invite_warning: guardianInviteWarning,
      message: conversion?.already_converted
        ? 'Visitor was already converted to this family Member. No duplicate was created.'
        : 'Visitor converted to a family-managed Member. Trial history was preserved.',
    })
  } catch (cause: any) {
    // Roll back only objects created by this request if the DB conversion did
    // not commit. Once the Visitor is linked to the Member, we never delete
    // Family/Auth records as part of error handling.
    if (!conversionCommitted) {
      try {
        if (createdGuardianLink) {
          await admin
            .from('family_guardians')
            .delete()
            .eq('family_id', createdGuardianLink.familyId)
            .eq('auth_user_id', createdGuardianLink.authUserId)
        }
      } catch {}
      try { if (createdFamilyId) await admin.from('families').delete().eq('id', createdFamilyId) } catch {}
      try { if (createdAuthUserId) await admin.auth.admin.deleteUser(createdAuthUserId) } catch {}
    }

    const message = String(cause?.message || cause || 'VISITOR_CONVERSION_FAILED')
    const conflictCodes = [
      'VISITOR_ALREADY_LINKED_TO_MEMBER',
      'GUARDIAN_LINK_AMBIGUOUS',
      'GUARDIAN_EMAIL_CONFLICT',
      'GUARDIAN_ALREADY_BELONGS_TO_ANOTHER_FAMILY',
      'FAMILY_INTAKE_NOT_FOUND',
      'FAMILY_INTAKE_CHILD_NOT_FOUND',
      'INTAKE_CHILD_CONVERSION_CONFLICT',
    ]
    const isConflict = conflictCodes.some((code) => message.includes(code))
    const status = isConflict ? 409 : 500

    return noStore(
      {
        ok: false,
        error: message.split(':')[0],
        details: message,
      },
      { status },
    )
  }
}
