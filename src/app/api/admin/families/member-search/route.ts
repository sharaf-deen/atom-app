export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { MEMBER_LIKE_ROLES } from '@/lib/rbac'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { getSessionUser } from '@/lib/session'

function noStore(body: any, init?: ResponseInit) {
  const response = NextResponse.json(body, init)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function sanitizeSearch(value: string) {
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
  if (me.role !== 'admin' && me.role !== 'super_admin') {
    return noStore({ ok: false, error: 'FORBIDDEN' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const q = sanitizeSearch(searchParams.get('q') ?? '')
  if (q.length < 2) return noStore({ ok: true, items: [] })

  const admin = createSupabaseAdminClient()
  const qDigits = digitsOnly(q)
  const filters = [
    `first_name.ilike.%${q}%`,
    `last_name.ilike.%${q}%`,
    `member_id.ilike.%${q}%`,
    `email.ilike.%${q}%`,
  ]

  if (qDigits.length >= 4) filters.push(`phone_digits.ilike.%${qDigits}%`)

  const { data: profiles, error } = await admin
    .from('profiles')
    .select('user_id,member_id,first_name,last_name,email,phone,role')
    .in('role', [...MEMBER_LIKE_ROLES])
    .or(filters.join(','))
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    return noStore(
      { ok: false, error: 'MEMBER_SEARCH_FAILED', details: error.message },
      { status: 500 },
    )
  }

  const memberIds = (profiles ?? []).map((profile: any) => profile.user_id).filter(Boolean)
  const familyByMember = new Map<string, { id: string; name: string }>()

  if (memberIds.length > 0) {
    const { data: links, error: linksError } = await admin
      .from('family_members')
      .select('member_id,family_id')
      .in('member_id', memberIds)

    if (linksError) {
      return noStore(
        { ok: false, error: 'FAMILY_LINK_LOOKUP_FAILED', details: linksError.message },
        { status: 500 },
      )
    }

    const familyIds = Array.from(new Set((links ?? []).map((link: any) => link.family_id).filter(Boolean)))
    const familyNameById = new Map<string, string>()

    if (familyIds.length > 0) {
      const { data: families, error: familiesError } = await admin
        .from('families')
        .select('id,name')
        .in('id', familyIds)

      if (familiesError) {
        return noStore(
          { ok: false, error: 'FAMILY_LOOKUP_FAILED', details: familiesError.message },
          { status: 500 },
        )
      }

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

  return noStore({
    ok: true,
    items: (profiles ?? []).map((profile: any) => ({
      user_id: profile.user_id,
      member_id: profile.member_id ?? null,
      first_name: profile.first_name ?? null,
      last_name: profile.last_name ?? null,
      email: profile.email ?? null,
      phone: profile.phone ?? null,
      current_family: familyByMember.get(String(profile.user_id)) ?? null,
    })),
  })
}
