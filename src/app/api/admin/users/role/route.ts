// src/app/api/admin/users/role/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { canManageRoles, isRole, normalizeRole, type Role } from '@/lib/rbac'

type Body = { user_id?: string; role?: Role } | Record<string, any>

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

export async function POST(req: Request) {
  try {
    const supabase = createSupabaseServerActionClient()

    // 1) Auth actor
    const { data: authData, error: authErr } = await supabase.auth.getUser()
    if (authErr) {
      return noStore(NextResponse.json({ ok: false, error: `AUTH_ERROR: ${authErr.message}` }, { status: 401 }))
    }
    const actor = authData.user
    if (!actor) {
      return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))
    }

    // 2) Actor role check (super_admin only)
    const { data: me, error: meErr } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', actor.id)
      .maybeSingle<{ role: Role | null }>()

    if (meErr) {
      return noStore(NextResponse.json({ ok: false, error: `ACTOR_PROFILE_ERROR: ${meErr.message}` }, { status: 500 }))
    }

    const actorRole = normalizeRole(me?.role)
    if (!canManageRoles(actorRole)) {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    // 3) Payload
    const body = (await req.json().catch(() => ({}))) as Body
    const user_id = String((body as any).user_id ?? '').trim()
    const roleRaw = (body as any).role

    if (!user_id) {
      return noStore(NextResponse.json({ ok: false, error: 'MISSING_USER_ID' }, { status: 400 }))
    }

    if (user_id === actor.id) {
      return noStore(NextResponse.json({ ok: false, error: 'CANNOT_CHANGE_OWN_ROLE' }, { status: 400 }))
    }

    if (!isRole(roleRaw)) {
      return noStore(NextResponse.json({ ok: false, error: 'INVALID_ROLE' }, { status: 400 }))
    }

    // 4) Call DB-guarded RPC (SECURITY DEFINER)
    const { data, error } = await supabase.rpc('admin_set_user_role', {
      target_user_id: user_id,
      new_role: roleRaw,
    })

    if (error) {
      return noStore(NextResponse.json({ ok: false, error: 'RPC_ERROR', details: error.message }, { status: 400 }))
    }

    return noStore(NextResponse.json({ ok: true, data }))
  } catch (e: any) {
    console.error('admin/users/role error:', e)
    return noStore(
      NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) }, { status: 500 }),
    )
  }
}
