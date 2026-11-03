// src/app/api/notifications/audience-counts/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function makeAdminClient() {
  try {
    return createSupabaseAdminClient()
  } catch {
    return null
  }
}

async function countRole(admin: any, role: string) {
  const { count, error } = await admin
    .from('profiles')
    .select('user_id', { head: true, count: 'exact' })
    .eq('role', role)

  if (error) return 0
  return Number(count || 0)
}

export async function GET() {
  try {
    const supa = createSupabaseServerActionClient()

    // Auth
    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) return json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    // Role check: admin & super_admin only
    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle()

    if (meErr) return json(500, { ok: false, error: 'PROFILE_ERROR', details: meErr.message })

    const role = (me?.role ?? 'member') as string
    if (role !== 'admin' && role !== 'super_admin' && role !== 'head_coach') {
      return json(403, { ok: false, error: 'FORBIDDEN' })
    }

    const admin = makeAdminClient()
    if (!admin) {
      return json(500, {
        ok: false,
        error: 'SERVICE_ROLE_MISSING',
        details: 'SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL) must be set on the server.',
      })
    }

    const [membersBase, champions, vips, coaches, assistant_coaches, head_coaches] = await Promise.all([
      countRole(admin, 'member'),
      countRole(admin, 'champion'),
      countRole(admin, 'vip'),
      countRole(admin, 'coach'),
      countRole(admin, 'assistant_coach'),
      countRole(admin, 'head_coach'),
    ])

    return json(200, { ok: true, members: membersBase + champions + vips, coaches, assistant_coaches, head_coaches })
  } catch (e: any) {
    console.error('notifications/audience-counts error:', e)
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
