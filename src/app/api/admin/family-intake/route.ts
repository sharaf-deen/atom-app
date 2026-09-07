export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { randomUUID } from 'crypto'
import { revalidatePath, revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { MEMBER_LIKE_ROLES, canAccessFamilyIntake, normalizeRole } from '@/lib/rbac'
import { extractActionLink, sendFamilyParentInviteEmail } from '@/lib/memberInviteEmail'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

type ChildMode = 'visitor' | 'member' | 'existing_visitor' | 'existing_member'
type SourceKey = 'walk_in' | 'instagram' | 'website' | 'referral' | 'whatsapp' | 'other'

type IntakeChild = {
  mode?: ChildMode
  firstName?: string
  lastName?: string
  dateOfBirth?: string
  phone?: string
  visitorTrialId?: string
  memberId?: string
  trialDate?: string
  sourceKey?: SourceKey
}

type IntakeBody = {
  guardian?: {
    mode?: 'new' | 'existing'
    existingAuthUserId?: string
    firstName?: string
    lastName?: string
    phone?: string
    email?: string
    relationship?: 'father' | 'mother' | 'parent' | 'guardian' | 'other'
  }
  familyName?: string
  children?: IntakeChild[]
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CHILD_MODES: ChildMode[] = ['visitor', 'member', 'existing_visitor', 'existing_member']
const SOURCES: SourceKey[] = ['walk_in', 'instagram', 'website', 'referral', 'whatsapp', 'other']
const RELATIONSHIPS = ['father', 'mother', 'parent', 'guardian', 'other'] as const

function noStore(body: any, init?: ResponseInit) {
  const response = NextResponse.json(body, init)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function text(value: unknown, max = 120) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function email(value: unknown) {
  return String(value ?? '').trim().toLowerCase().slice(0, 320)
}

function phone(value: unknown) {
  return String(value ?? '').trim().slice(0, 40)
}

function phoneDigits(value: unknown) {
  return String(value ?? '').replace(/\D+/g, '')
}

function isDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return !Number.isNaN(dt.getTime()) && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

function cairoTodayDateOnly() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${map.year}-${map.month}-${map.day}`
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
    const user = users.find((candidate: any) => String(candidate?.email ?? '').toLowerCase() === targetEmail) ?? null
    if (user) return { user, error: null }
    if (users.length < perPage) break
  }
  return { user: null, error: null }
}

function revalidateFamilyIntakeViews() {
  for (const path of ['/admin/members/family-intake', '/admin/members/families', '/admin/visitors', '/members', '/admin/members']) {
    try { revalidatePath(path) } catch {}
  }
  try { revalidateTag('members') } catch {}
}

export async function POST(req: Request) {
  const actor = await requireFrontDeskActor()
  if ('error' in actor) return actor.error

  let body: IntakeBody
  try {
    body = (await req.json()) as IntakeBody
  } catch {
    return noStore({ ok: false, error: 'INVALID_BODY' }, { status: 400 })
  }

  const guardianMode = body.guardian?.mode === 'existing' ? 'existing' : 'new'
  const existingGuardianAuthUserId = text(body.guardian?.existingAuthUserId, 80)
  let guardianFirstName = text(body.guardian?.firstName)
  let guardianLastName = text(body.guardian?.lastName)
  let guardianPhone = phone(body.guardian?.phone)
  let guardianEmail = email(body.guardian?.email)
  let guardianRelationship = RELATIONSHIPS.includes(body.guardian?.relationship as any)
    ? (body.guardian?.relationship as (typeof RELATIONSHIPS)[number])
    : 'parent'
  const children = Array.isArray(body.children) ? body.children.slice(0, 8) : []

  if (guardianMode === 'new' && !guardianFirstName) return noStore({ ok: false, error: 'GUARDIAN_FIRST_NAME_REQUIRED' }, { status: 400 })
  if (!guardianPhone && !guardianEmail) return noStore({ ok: false, error: 'GUARDIAN_CONTACT_REQUIRED' }, { status: 400 })
  if (guardianEmail && !EMAIL_RE.test(guardianEmail)) return noStore({ ok: false, error: 'INVALID_GUARDIAN_EMAIL' }, { status: 400 })
  if (!children.length) return noStore({ ok: false, error: 'AT_LEAST_ONE_CHILD_REQUIRED' }, { status: 400 })
  if (guardianMode === 'existing' && !UUID_RE.test(existingGuardianAuthUserId)) {
    return noStore({ ok: false, error: 'INVALID_EXISTING_GUARDIAN' }, { status: 400 })
  }

  const normalizedChildren = children.map((raw, index) => {
    const mode = CHILD_MODES.includes(raw.mode as ChildMode) ? (raw.mode as ChildMode) : 'visitor'
    const firstName = text(raw.firstName)
    const lastName = text(raw.lastName)
    const dateOfBirth = text(raw.dateOfBirth, 20)
    const childPhone = phone(raw.phone)
    const visitorTrialId = text(raw.visitorTrialId, 80)
    const memberId = text(raw.memberId, 80)
    const trialDate = text(raw.trialDate, 20) || cairoTodayDateOnly()
    const sourceKey = SOURCES.includes(raw.sourceKey as SourceKey) ? (raw.sourceKey as SourceKey) : 'walk_in'

    if (mode === 'visitor' || mode === 'member') {
      if (!firstName || !lastName) throw new Error(`CHILD_${index + 1}_NAME_REQUIRED`)
      if (dateOfBirth && (!isDateOnly(dateOfBirth) || dateOfBirth > cairoTodayDateOnly())) {
        throw new Error(`CHILD_${index + 1}_INVALID_DOB`)
      }
    }
    if (mode === 'visitor' && !isDateOnly(trialDate)) throw new Error(`CHILD_${index + 1}_INVALID_TRIAL_DATE`)
    if (mode === 'existing_visitor' && !UUID_RE.test(visitorTrialId)) throw new Error(`CHILD_${index + 1}_VISITOR_REQUIRED`)
    if (mode === 'existing_member' && !UUID_RE.test(memberId)) throw new Error(`CHILD_${index + 1}_MEMBER_REQUIRED`)

    return { mode, firstName, lastName, dateOfBirth: dateOfBirth || null, phone: childPhone || null, visitorTrialId, memberId, trialDate, sourceKey }
  })

  const needsFamily = normalizedChildren.some((child) => child.mode === 'member' || child.mode === 'existing_member')
  const hasVisitorChild = normalizedChildren.some((child) => child.mode === 'visitor' || child.mode === 'existing_visitor')
  if (needsFamily && guardianMode === 'new' && !guardianEmail) {
    return noStore({ ok: false, error: 'GUARDIAN_EMAIL_REQUIRED_FOR_MEMBER_FAMILY' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  let createdAuthUserId: string | null = null
  let createdFamilyId: string | null = null
  let createdGuardianLink: { familyId: string; authUserId: string } | null = null
  const createdVisitorIds: string[] = []
  const createdMemberIds: string[] = []
  const linkedExistingMemberIds: string[] = []
  let intakeId: string | null = null
  let resolvedGuardianAuthUserId: string | null = null
  let resolvedFamilyId: string | null = null

  try {
    let existingGuardian: any = null

    if (guardianMode === 'existing') {
      const { data, error } = await admin
        .from('family_guardians')
        .select('family_id,auth_user_id,email,first_name,last_name,phone,relationship,is_primary')
        .eq('auth_user_id', existingGuardianAuthUserId)
        .limit(2)

      if (error) throw new Error(`GUARDIAN_LOOKUP_FAILED: ${error.message}`)
      if (!data?.length) throw new Error('EXISTING_GUARDIAN_NOT_FOUND')
      if (data.length > 1) throw new Error('GUARDIAN_LINK_AMBIGUOUS')
      existingGuardian = data[0]
      resolvedGuardianAuthUserId = String(existingGuardian.auth_user_id)
      resolvedFamilyId = String(existingGuardian.family_id)
      guardianFirstName = guardianFirstName || text(existingGuardian.first_name) || 'Guardian'
      guardianLastName = guardianLastName || text(existingGuardian.last_name)
      guardianPhone = guardianPhone || phone(existingGuardian.phone)
      guardianEmail = guardianEmail || email(existingGuardian.email)
      if (RELATIONSHIPS.includes(existingGuardian.relationship as any)) guardianRelationship = existingGuardian.relationship
    } else if (guardianEmail) {
      const { data: exactGuardians, error: exactGuardianError } = await admin
        .from('family_guardians')
        .select('family_id,auth_user_id,email,first_name,last_name,phone,relationship,is_primary')
        .ilike('email', guardianEmail)
        .limit(2)

      if (exactGuardianError) throw new Error(`GUARDIAN_LOOKUP_FAILED: ${exactGuardianError.message}`)
      if ((exactGuardians ?? []).length > 1) throw new Error('GUARDIAN_LINK_AMBIGUOUS')
      if (exactGuardians?.[0]) {
        existingGuardian = exactGuardians[0]
        resolvedGuardianAuthUserId = String(existingGuardian.auth_user_id)
        resolvedFamilyId = String(existingGuardian.family_id)
        guardianFirstName = guardianFirstName || text(existingGuardian.first_name) || 'Guardian'
        guardianLastName = guardianLastName || text(existingGuardian.last_name)
        guardianPhone = guardianPhone || phone(existingGuardian.phone)
        guardianEmail = guardianEmail || email(existingGuardian.email)
        if (RELATIONSHIPS.includes(existingGuardian.relationship as any)) guardianRelationship = existingGuardian.relationship
      }
    }

    // Soft duplicate guard for a phone match with a different/no email.
    if (!existingGuardian && guardianPhone) {
      const digits = phoneDigits(guardianPhone)
      if (digits.length >= 7) {
        const { data: phoneCandidates } = await admin
          .from('family_guardians')
          .select('family_id,auth_user_id,email,first_name,last_name,phone,is_primary')
          .not('phone', 'is', null)
          .limit(1000)
        const phoneMatch = (phoneCandidates ?? []).find((row: any) => phoneDigits(row.phone) === digits)
        if (phoneMatch) {
          const { data: family } = await admin.from('families').select('id,name').eq('id', phoneMatch.family_id).maybeSingle()
          return noStore(
            {
              ok: false,
              error: 'POSSIBLE_GUARDIAN_DUPLICATE',
              candidate: {
                auth_user_id: phoneMatch.auth_user_id,
                family_id: phoneMatch.family_id,
                family_name: family?.name ?? 'Family',
                email: phoneMatch.email ?? null,
                first_name: phoneMatch.first_name ?? null,
                last_name: phoneMatch.last_name ?? null,
                phone: phoneMatch.phone ?? null,
              },
            },
            { status: 409 },
          )
        }
      }
    }

    const familyNameInput = text(body.familyName)
    const defaultFamilyName = `${guardianLastName || guardianFirstName} Family`.trim()
    const familyName = familyNameInput || defaultFamilyName

    if (needsFamily && !resolvedFamilyId) {
      const { data: family, error: familyError } = await admin
        .from('families')
        .insert({ name: familyName, created_by: actor.actorId })
        .select('id,name')
        .single()
      if (familyError || !family) throw new Error(`CREATE_FAMILY_FAILED: ${familyError?.message ?? 'Unknown error'}`)
      createdFamilyId = String(family.id)
      resolvedFamilyId = createdFamilyId
    }

    if (needsFamily && !resolvedGuardianAuthUserId) {
      const { user: authUser, error: authLookupError } = await findAuthUserByEmail(admin, guardianEmail)
      if (authLookupError) throw new Error(`AUTH_LOOKUP_FAILED: ${authLookupError.message}`)
      resolvedGuardianAuthUserId = authUser?.id ?? null

      if (!resolvedGuardianAuthUserId) {
        const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
        const redirectTo = `${appUrl}/auth/complete-invite?next=%2Ffamily`
        const metadata = {
          account_type: 'family_parent',
          family_id: resolvedFamilyId,
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
              const sent = await sendFamilyParentInviteEmail({
                to: guardianEmail,
                actionLink,
                firstName: guardianFirstName,
                lastName: guardianLastName,
                familyName,
              })
              if (sent.sent) {
                resolvedGuardianAuthUserId = linkData.user.id
                createdAuthUserId = linkData.user.id
              } else {
                await admin.auth.admin.deleteUser(linkData.user.id).catch(() => null)
              }
            } else {
              await admin.auth.admin.deleteUser(linkData.user.id).catch(() => null)
            }
          }
        }

        if (!resolvedGuardianAuthUserId) {
          const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(guardianEmail, {
            redirectTo,
            data: metadata,
          })
          if (inviteError || !invited?.user?.id) throw new Error(`CREATE_GUARDIAN_AUTH_FAILED: ${inviteError?.message ?? 'Could not invite guardian'}`)
          resolvedGuardianAuthUserId = invited.user.id
          createdAuthUserId = invited.user.id
        }
      }

      const { data: guardianLinks, error: guardianLinkLookupError } = await admin
        .from('family_guardians')
        .select('family_id,auth_user_id')
        .eq('auth_user_id', resolvedGuardianAuthUserId)
        .limit(2)
      if (guardianLinkLookupError) throw new Error(`GUARDIAN_LINK_LOOKUP_FAILED: ${guardianLinkLookupError.message}`)
      if (guardianLinks?.length) {
        const existingFamilyId = String(guardianLinks[0].family_id)
        if (existingFamilyId !== resolvedFamilyId) throw new Error('GUARDIAN_ALREADY_BELONGS_TO_ANOTHER_FAMILY')
      } else {
        const { error: guardianInsertError } = await admin.from('family_guardians').insert({
          family_id: resolvedFamilyId,
          auth_user_id: resolvedGuardianAuthUserId,
          email: guardianEmail,
          first_name: guardianFirstName,
          last_name: guardianLastName || null,
          phone: guardianPhone || null,
          relationship: guardianRelationship,
          is_primary: true,
          invited_at: createdAuthUserId ? new Date().toISOString() : null,
          created_by: actor.actorId,
        })
        if (guardianInsertError) throw new Error(`CREATE_GUARDIAN_LINK_FAILED: ${guardianInsertError.message}`)
        createdGuardianLink = { familyId: resolvedFamilyId!, authUserId: resolvedGuardianAuthUserId }
      }
    }

    if (!needsFamily && guardianEmail && !resolvedGuardianAuthUserId) {
      const { user } = await findAuthUserByEmail(admin, guardianEmail)
      resolvedGuardianAuthUserId = user?.id ?? null
    }

    const { data: intake, error: intakeError } = await admin
      .from('family_intakes')
      .insert({
        guardian_first_name: guardianFirstName,
        guardian_last_name: guardianLastName || null,
        guardian_phone: guardianPhone || null,
        guardian_email: guardianEmail || null,
        guardian_relationship: guardianRelationship,
        guardian_auth_user_id: resolvedGuardianAuthUserId,
        family_id: resolvedFamilyId,
        status: resolvedFamilyId ? 'family_created' : 'open',
        created_by: actor.actorId,
        updated_by: actor.actorId,
      })
      .select('id,status,family_id')
      .single()

    if (intakeError || !intake) throw new Error(`CREATE_INTAKE_FAILED: ${intakeError?.message ?? 'Unknown error'}`)
    intakeId = String(intake.id)

    const createdChildren: any[] = []

    for (const child of normalizedChildren) {
      if (child.mode === 'visitor') {
        const { data: visitor, error: visitorError } = await admin
          .from('visitor_trials')
          .insert({
            first_name: child.firstName,
            last_name: child.lastName,
            phone: child.phone,
            email: null,
            date_of_birth: child.dateOfBirth,
            family_intake_id: intakeId,
            source_key: child.sourceKey,
            status: 'booked',
            trial_date: child.trialDate,
            notes: 'Created from Family Intake.',
            created_by: actor.actorId,
            updated_by: actor.actorId,
          })
          .select('id,first_name,last_name,trial_date,status')
          .single()
        if (visitorError || !visitor) throw new Error(`CREATE_VISITOR_FAILED: ${visitorError?.message ?? 'Unknown error'}`)
        createdVisitorIds.push(String(visitor.id))

        const { error: childLinkError } = await admin.from('family_intake_children').insert({
          intake_id: intakeId,
          child_kind: 'visitor',
          first_name: child.firstName,
          last_name: child.lastName,
          date_of_birth: child.dateOfBirth,
          phone: child.phone,
          visitor_trial_id: visitor.id,
          created_by: actor.actorId,
        })
        if (childLinkError) throw new Error(`CREATE_INTAKE_CHILD_FAILED: ${childLinkError.message}`)
        createdChildren.push({ kind: 'visitor', ...visitor })
        continue
      }

      if (child.mode === 'existing_visitor') {
        const { data: visitor, error: visitorError } = await admin
          .from('visitor_trials')
          .select('id,first_name,last_name,phone,date_of_birth,status,linked_member_id,family_intake_id,trial_date')
          .eq('id', child.visitorTrialId)
          .maybeSingle()
        if (visitorError || !visitor) throw new Error('VISITOR_NOT_FOUND')
        if (visitor.linked_member_id) throw new Error('VISITOR_ALREADY_LINKED_TO_MEMBER')
        if (visitor.family_intake_id && String(visitor.family_intake_id) !== intakeId) throw new Error('VISITOR_ALREADY_IN_ANOTHER_INTAKE')

        const { error: visitorUpdateError } = await admin
          .from('visitor_trials')
          .update({ family_intake_id: intakeId, updated_by: actor.actorId })
          .eq('id', visitor.id)
        if (visitorUpdateError) throw new Error(`LINK_VISITOR_TO_INTAKE_FAILED: ${visitorUpdateError.message}`)

        const { error: childLinkError } = await admin.from('family_intake_children').insert({
          intake_id: intakeId,
          child_kind: 'existing_visitor',
          first_name: visitor.first_name,
          last_name: visitor.last_name,
          date_of_birth: visitor.date_of_birth,
          phone: visitor.phone,
          visitor_trial_id: visitor.id,
          created_by: actor.actorId,
        })
        if (childLinkError) throw new Error(`CREATE_INTAKE_CHILD_FAILED: ${childLinkError.message}`)
        createdChildren.push({ kind: 'existing_visitor', ...visitor })
        continue
      }

      if (!resolvedFamilyId) throw new Error('FAMILY_REQUIRED_FOR_MEMBER_CHILD')

      if (child.mode === 'member') {
        const memberUuid = randomUUID()
        const { data: member, error: memberError } = await admin
          .from('profiles')
          .insert({
            user_id: memberUuid,
            email: null,
            first_name: child.firstName,
            last_name: child.lastName,
            phone: child.phone,
            date_of_birth: child.dateOfBirth,
            role: 'member',
            qr_code: `atom:${memberUuid}`,
          })
          .select('user_id,member_id,first_name,last_name,phone,date_of_birth,qr_code')
          .single()
        if (memberError || !member) throw new Error(`CREATE_DEPENDENT_MEMBER_FAILED: ${memberError?.message ?? 'Unknown error'}`)
        createdMemberIds.push(memberUuid)

        const { error: familyLinkError } = await admin.from('family_members').insert({
          family_id: resolvedFamilyId,
          member_id: memberUuid,
          added_by: actor.actorId,
        })
        if (familyLinkError) throw new Error(`LINK_DEPENDENT_MEMBER_FAILED: ${familyLinkError.message}`)

        const { error: childLinkError } = await admin.from('family_intake_children').insert({
          intake_id: intakeId,
          child_kind: 'member',
          first_name: child.firstName,
          last_name: child.lastName,
          date_of_birth: child.dateOfBirth,
          phone: child.phone,
          member_id: memberUuid,
          created_by: actor.actorId,
        })
        if (childLinkError) throw new Error(`CREATE_INTAKE_CHILD_FAILED: ${childLinkError.message}`)
        createdChildren.push({ kind: 'member', ...member })
        continue
      }

      const { data: member, error: memberError } = await admin
        .from('profiles')
        .select('user_id,member_id,first_name,last_name,phone,date_of_birth,role')
        .eq('user_id', child.memberId)
        .maybeSingle()
      if (memberError || !member) throw new Error('MEMBER_NOT_FOUND')
      if (!(MEMBER_LIKE_ROLES as readonly string[]).includes(normalizeRole(member.role))) throw new Error('PROFILE_IS_NOT_A_MEMBER')

      const { data: existingLink, error: existingLinkError } = await admin
        .from('family_members')
        .select('family_id')
        .eq('member_id', member.user_id)
        .maybeSingle()
      if (existingLinkError) throw new Error(`FAMILY_LINK_LOOKUP_FAILED: ${existingLinkError.message}`)
      if (existingLink?.family_id && String(existingLink.family_id) !== resolvedFamilyId) {
        throw new Error('EXISTING_MEMBER_ALREADY_IN_ANOTHER_FAMILY')
      }
      if (!existingLink?.family_id) {
        const { error: familyLinkError } = await admin.from('family_members').insert({
          family_id: resolvedFamilyId,
          member_id: member.user_id,
          added_by: actor.actorId,
        })
        if (familyLinkError) throw new Error(`LINK_EXISTING_MEMBER_FAILED: ${familyLinkError.message}`)
        linkedExistingMemberIds.push(String(member.user_id))
      }

      const { error: childLinkError } = await admin.from('family_intake_children').insert({
        intake_id: intakeId,
        child_kind: 'existing_member',
        first_name: member.first_name,
        last_name: member.last_name,
        date_of_birth: member.date_of_birth,
        phone: member.phone,
        member_id: member.user_id,
        created_by: actor.actorId,
      })
      if (childLinkError) throw new Error(`CREATE_INTAKE_CHILD_FAILED: ${childLinkError.message}`)
      createdChildren.push({ kind: 'existing_member', ...member })
    }

    const finalIntakeStatus = hasVisitorChild ? (resolvedFamilyId ? 'family_created' : 'open') : 'completed'
    await admin
      .from('family_intakes')
      .update({ status: finalIntakeStatus, updated_by: actor.actorId })
      .eq('id', intakeId)

    revalidateFamilyIntakeViews()
    return noStore({
      ok: true,
      intake_id: intakeId,
      family_id: resolvedFamilyId,
      guardian_auth_user_id: resolvedGuardianAuthUserId,
      family_created: Boolean(createdFamilyId),
      auth_account_created: Boolean(createdAuthUserId),
      children: createdChildren,
      next_step: hasVisitorChild ? 'visitor_follow_up' : 'family_ready',
      message: hasVisitorChild
        ? (resolvedFamilyId
          ? 'Family intake saved. Existing/new members are linked and visitor children remain ready for follow-up.'
          : 'Trial intake saved. No Family Account or guardian login was created yet.')
        : 'Family intake completed and family members are ready.',
    })
  } catch (cause: any) {
    // Roll back only records created by this request. Existing family/guardian/member data is never deleted.
    try { if (createdVisitorIds.length) await admin.from('visitor_trials').delete().in('id', createdVisitorIds) } catch {}
    try { if (createdMemberIds.length) await admin.from('profiles').delete().in('user_id', createdMemberIds) } catch {}
    try { if (intakeId) await admin.from('family_intakes').delete().eq('id', intakeId) } catch {}
    try {
      if (linkedExistingMemberIds.length && !createdFamilyId && resolvedFamilyId) {
        await admin.from('family_members').delete().eq('family_id', resolvedFamilyId).in('member_id', linkedExistingMemberIds)
      }
    } catch {}
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

    const message = String(cause?.message || cause || 'FAMILY_INTAKE_FAILED')
    const conflict = [
      'EXISTING_GUARDIAN_NOT_FOUND',
      'GUARDIAN_LINK_AMBIGUOUS',
      'GUARDIAN_ALREADY_BELONGS_TO_ANOTHER_FAMILY',
      'VISITOR_ALREADY_LINKED_TO_MEMBER',
      'VISITOR_ALREADY_IN_ANOTHER_INTAKE',
      'EXISTING_MEMBER_ALREADY_IN_ANOTHER_FAMILY',
    ].some((code) => message.includes(code))

    return noStore(
      { ok: false, error: message.split(':')[0], details: message },
      { status: conflict ? 409 : 500 },
    )
  }
}
