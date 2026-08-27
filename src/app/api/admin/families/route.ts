export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { MEMBER_LIKE_ROLES, normalizeRole } from '@/lib/rbac'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

type ActionBody =
  | { action?: 'create'; familyName?: string }
  | { action?: 'link_member'; familyId?: string; memberId?: string }
  | { action?: 'unlink_member'; familyId?: string; memberId?: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

    return noStore({ ok: true })
  }

  return noStore({ ok: false, error: 'UNKNOWN_ACTION' }, { status: 400 })
}
