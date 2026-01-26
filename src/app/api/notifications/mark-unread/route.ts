// src/app/api/notifications/mark-unread/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

type Body = { ids?: string[] } | Record<string, any>

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    // Auth
    const { data: authData, error: authErr } = await supa.auth.getUser()
    if (authErr) {
      return noStore(
        NextResponse.json({ ok: false, error: `AUTH_ERROR: ${authErr.message}` }, { status: 401 }),
      )
    }
    const actor = authData.user
    if (!actor) {
      return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))
    }

    // Role check (super_admin only)
    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', actor.id)
      .maybeSingle()

    if (meErr) {
      return noStore(
        NextResponse.json({ ok: false, error: `PROFILE_ERROR: ${meErr.message}` }, { status: 500 }),
      )
    }

    if ((me?.role ?? 'member') !== 'super_admin') {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    const body = (await req.json()) as Body
    const ids = Array.isArray((body as any).ids) ? ((body as any).ids as any[]).map(String) : []
    const cleanIds = ids.map((s) => s.trim()).filter(Boolean)

    if (cleanIds.length === 0) {
      return noStore(NextResponse.json({ ok: false, error: 'NO_IDS' }, { status: 400 }))
    }

    // Only affect notifications owned by the actor
    const { error: upErr } = await supa
      .from('notifications')
      .update({ read_at: null })
      .in('id', cleanIds)
      .eq('user_id', actor.id)

    if (upErr) {
      return noStore(NextResponse.json({ ok: false, error: upErr.message }, { status: 400 }))
    }

    return noStore(NextResponse.json({ ok: true, count: cleanIds.length }))
  } catch (e: any) {
    console.error('notifications/mark-unread error:', e)
    return noStore(
      NextResponse.json(
        { ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) },
        { status: 500 },
      ),
    )
  }
}
