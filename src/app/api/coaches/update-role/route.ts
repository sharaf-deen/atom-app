// src/app/api/coaches/update-role/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import type { Role as AppRole } from '@/lib/session'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createClient } from '@supabase/supabase-js'

type TargetRole = 'coach' | 'assistant_coach' | 'member'

type Body =
  | {
      user_id?: string
      role?: TargetRole
    }
  | Record<string, any>

const ALLOWED_ACTORS: AppRole[] = ['admin', 'super_admin']
const can = (r: AppRole) => ALLOWED_ACTORS.includes(r)

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    // 1) Auth actor
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

    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', actor.id)
      .maybeSingle()

    if (meErr) {
      return noStore(
        NextResponse.json({ ok: false, error: `ACTOR_PROFILE_ERROR: ${meErr.message}` }, { status: 500 }),
      )
    }

    const actorRole = (me?.role ?? 'member') as AppRole
    if (!can(actorRole)) {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    // 2) Payload
    const body = (await req.json()) as Body
    const user_id = String((body as any).user_id ?? '').trim()
    const role = String((body as any).role ?? '').trim() as TargetRole

    if (!user_id) {
      return noStore(NextResponse.json({ ok: false, error: 'MISSING_USER_ID' }, { status: 400 }))
    }

    if (role !== 'coach' && role !== 'assistant_coach' && role !== 'member') {
      return noStore(NextResponse.json({ ok: false, error: 'INVALID_ROLE' }, { status: 400 }))
    }

    // 3) Admin client (service role)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!url || !serviceKey) {
      return noStore(NextResponse.json({ ok: false, error: 'SERVER_MISCONFIGURED' }, { status: 500 }))
    }

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // 4) Ensure target exists and is currently a coach/assistant_coach
    const { data: existing, error: exErr } = await admin
      .from('profiles')
      .select('role')
      .eq('user_id', user_id)
      .maybeSingle()

    if (exErr) {
      return noStore(NextResponse.json({ ok: false, error: exErr.message }, { status: 400 }))
    }

    const currentRole = (existing?.role ?? null) as string | null
    if (currentRole !== 'coach' && currentRole !== 'assistant_coach') {
      return noStore(NextResponse.json({ ok: false, error: 'NOT_A_COACH_PROFILE' }, { status: 400 }))
    }

    const { error: upErr } = await admin.from('profiles').update({ role }).eq('user_id', user_id)
    if (upErr) {
      return noStore(NextResponse.json({ ok: false, error: upErr.message }, { status: 400 }))
    }

    return noStore(NextResponse.json({ ok: true, user_id, role }))
  } catch (e: any) {
    console.error('coaches/update-role error:', e)
    return noStore(
      NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) }, { status: 500 }),
    )
  }
}
