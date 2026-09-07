export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { MEMBER_LIKE_ROLES, canAccessFamilyIntake } from '@/lib/rbac'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { getSessionUser } from '@/lib/session'

function noStore(body: any, init?: ResponseInit) {
  const response = NextResponse.json(body, init)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function cleanQuery(value: string) {
  return value
    .replace(/[,%()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

function digitsOnly(value: string) {
  return value.replace(/\D+/g, '')
}

export async function GET(req: Request) {
  const me = await getSessionUser()
  if (!me) return noStore({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 })
  if (!canAccessFamilyIntake(me.role)) {
    return noStore({ ok: false, error: 'FORBIDDEN' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const scope = String(searchParams.get('scope') ?? '').trim()
  const q = cleanQuery(searchParams.get('q') ?? '')
  if (q.length < 2) return noStore({ ok: true, items: [] })

  const admin = createSupabaseAdminClient()
  const qDigits = digitsOnly(q)

  if (scope === 'guardian') {
    const filters = [
      `first_name.ilike.%${q}%`,
      `last_name.ilike.%${q}%`,
      `email.ilike.%${q}%`,
      `phone.ilike.%${q}%`,
    ]

    const { data: guardians, error } = await admin
      .from('family_guardians')
      .select('family_id,auth_user_id,email,first_name,last_name,phone,relationship,is_primary,created_at')
      .or(filters.join(','))
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      return noStore({ ok: false, error: 'GUARDIAN_SEARCH_FAILED', details: error.message }, { status: 500 })
    }

    const familyIds = Array.from(new Set((guardians ?? []).map((row: any) => String(row.family_id || '')).filter(Boolean)))
    const familyNameById = new Map<string, string>()

    if (familyIds.length) {
      const { data: families, error: familyError } = await admin
        .from('families')
        .select('id,name')
        .in('id', familyIds)

      if (familyError) {
        return noStore({ ok: false, error: 'FAMILY_LOOKUP_FAILED', details: familyError.message }, { status: 500 })
      }
      for (const family of families ?? []) {
        familyNameById.set(String((family as any).id), String((family as any).name ?? 'Family'))
      }
    }

    return noStore({
      ok: true,
      items: (guardians ?? []).map((row: any) => ({
        kind: 'guardian',
        auth_user_id: row.auth_user_id,
        family_id: row.family_id,
        family_name: familyNameById.get(String(row.family_id)) ?? 'Family',
        email: row.email ?? null,
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
        phone: row.phone ?? null,
        relationship: row.relationship ?? 'parent',
        is_primary: Boolean(row.is_primary),
      })),
    })
  }

  if (scope === 'child') {
    const memberFilters = [
      `first_name.ilike.%${q}%`,
      `last_name.ilike.%${q}%`,
      `member_id.ilike.%${q}%`,
      `email.ilike.%${q}%`,
    ]
    if (qDigits.length >= 4) memberFilters.push(`phone_digits.ilike.%${qDigits}%`)

    const visitorFilters = [
      `first_name.ilike.%${q}%`,
      `last_name.ilike.%${q}%`,
      `phone.ilike.%${q}%`,
      `email.ilike.%${q}%`,
    ]

    const [{ data: profiles, error: memberError }, { data: visitors, error: visitorError }] = await Promise.all([
      admin
        .from('profiles')
        .select('user_id,member_id,first_name,last_name,email,phone,date_of_birth,role')
        .in('role', [...MEMBER_LIKE_ROLES])
        .or(memberFilters.join(','))
        .order('created_at', { ascending: false })
        .limit(20),
      admin
        .from('visitor_trials')
        .select('id,first_name,last_name,phone,email,date_of_birth,status,trial_date,linked_member_id,family_intake_id,created_at')
        .or(visitorFilters.join(','))
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    if (memberError || visitorError) {
      return noStore(
        {
          ok: false,
          error: 'CHILD_SEARCH_FAILED',
          details: memberError?.message ?? visitorError?.message ?? null,
        },
        { status: 500 },
      )
    }

    const memberIds = (profiles ?? []).map((row: any) => String(row.user_id || '')).filter(Boolean)
    const familyByMember = new Map<string, { id: string; name: string }>()

    if (memberIds.length) {
      const { data: links, error: linkError } = await admin
        .from('family_members')
        .select('member_id,family_id')
        .in('member_id', memberIds)

      if (linkError) {
        return noStore({ ok: false, error: 'FAMILY_LINK_LOOKUP_FAILED', details: linkError.message }, { status: 500 })
      }

      const familyIds = Array.from(new Set((links ?? []).map((row: any) => String(row.family_id || '')).filter(Boolean)))
      const familyNameById = new Map<string, string>()
      if (familyIds.length) {
        const { data: families } = await admin.from('families').select('id,name').in('id', familyIds)
        for (const family of families ?? []) {
          familyNameById.set(String((family as any).id), String((family as any).name ?? 'Family'))
        }
      }

      for (const link of links ?? []) {
        const memberId = String((link as any).member_id)
        const familyId = String((link as any).family_id)
        familyByMember.set(memberId, {
          id: familyId,
          name: familyNameById.get(familyId) ?? 'Family',
        })
      }
    }

    const items = [
      ...(visitors ?? []).map((row: any) => ({
        kind: 'visitor',
        id: row.id,
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
        phone: row.phone ?? null,
        email: row.email ?? null,
        date_of_birth: row.date_of_birth ?? null,
        status: row.status ?? null,
        trial_date: row.trial_date ?? null,
        linked_member_id: row.linked_member_id ?? null,
        family_intake_id: row.family_intake_id ?? null,
      })),
      ...(profiles ?? []).map((row: any) => ({
        kind: 'member',
        id: row.user_id,
        member_id: row.member_id ?? null,
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
        phone: row.phone ?? null,
        email: row.email ?? null,
        date_of_birth: row.date_of_birth ?? null,
        current_family: familyByMember.get(String(row.user_id)) ?? null,
      })),
    ]

    return noStore({ ok: true, items })
  }

  return noStore({ ok: false, error: 'INVALID_SCOPE' }, { status: 400 })
}
