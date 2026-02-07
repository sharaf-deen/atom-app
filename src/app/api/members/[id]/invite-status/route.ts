// src/app/api/members/[id]/invite-status/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import type { Role } from '@/lib/session'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createClient } from '@supabase/supabase-js'

const STAFF: Role[] = ['reception', 'admin', 'super_admin']
const can = (r: Role) => STAFF.includes(r)

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
}

type InviteStatus =
  | 'active'
  | 'pending'
  | 'missing_auth_user'
  | 'not_found'
  | 'forbidden'

export async function GET(req: Request, ctx: { params: { id: string } }) {
  const memberUserId = String(ctx?.params?.id ?? '').trim()
  if (!isUuid(memberUserId)) {
    return noStore(NextResponse.json({ ok: false, error: 'INVALID_MEMBER_ID' }, { status: 400 }))
  }

  try {
    // 1) Auth actor (staff only)
    const supa = createSupabaseServerActionClient()
    const { data: authData, error: authErr } = await supa.auth.getUser()
    if (authErr) return noStore(NextResponse.json({ ok: false, error: `AUTH_ERROR: ${authErr.message}` }, { status: 401 }))

    const actor = authData.user
    if (!actor) return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))

    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', actor.id)
      .maybeSingle()

    if (meErr) {
      return noStore(NextResponse.json({ ok: false, error: `ACTOR_PROFILE_ERROR: ${meErr.message}` }, { status: 500 }))
    }

    const role = (me?.role ?? 'member') as Role
    if (!can(role)) {
      return noStore(NextResponse.json({ ok: false, status: 'forbidden' as InviteStatus }, { status: 403 }))
    }

    // 2) Service role
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) {
      return noStore(NextResponse.json({ ok: false, error: 'SERVER_MISCONFIGURED' }, { status: 500 }))
    }

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // 3) Profile exists?
    const { data: prof, error: profErr } = await admin
      .from('profiles')
      .select('user_id, email')
      .eq('user_id', memberUserId)
      .maybeSingle()

    if (profErr) {
      return noStore(NextResponse.json({ ok: false, error: 'PROFILE_LOOKUP_FAILED', details: profErr.message }, { status: 500 }))
    }
    if (!prof?.user_id) {
      return noStore(NextResponse.json({ ok: false, status: 'not_found' as InviteStatus }, { status: 404 }))
    }

    // 4) Auth user by id
    let authUser: any = null
    let authMissing = false
    try {
      const r = await (admin.auth.admin as any).getUserById(memberUserId)
      authUser = r?.data?.user ?? null
      if (!authUser) authMissing = true
    } catch {
      authMissing = true
    }

    const confirmedAt = authUser?.email_confirmed_at || authUser?.confirmed_at || null
    const status: InviteStatus = authMissing
      ? 'missing_auth_user'
      : confirmedAt
        ? 'active'
        : 'pending'

    // 5) last resend info (optional)
    const { data: lastAudit } = await admin
      .from('audit_logs')
      .select('created_at, action_details')
      .eq('target_user_id', memberUserId)
      .eq('action', 'member_invite_resend')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    return noStore(
      NextResponse.json({
        ok: true,
        status,
        email: prof.email ?? null,
        confirmed_at: confirmedAt,
        last_invite_sent_at: lastAudit?.created_at ?? null,
      }),
    )
  } catch (e: any) {
    return noStore(
      NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) }, { status: 500 }),
    )
  }
}
