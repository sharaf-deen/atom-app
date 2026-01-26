// src/app/api/notifications/delete/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

function normalizeIds(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const cleaned = v
    .filter((x) => typeof x === 'string')
    .map((x) => x.trim())
    .filter(Boolean)
  // uniq + cap
  return Array.from(new Set(cleaned)).slice(0, 100)
}

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) return json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const body = await req.json().catch(() => ({} as any))
    const ids = normalizeIds(body?.ids)

    if (ids.length === 0) {
      return json(400, { ok: false, error: 'NO_IDS', details: 'Provide ids: string[]' })
    }

    // Use service role to bypass RLS safely, while still enforcing ownership server-side
    const admin = makeAdminClient()
    if (!admin) {
      return json(500, {
        ok: false,
        error: 'SERVICE_ROLE_MISSING',
        details: 'SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL) must be set on the server.',
      })
    }

    const { data, error } = await admin
      .from('notifications')
      .delete()
      .in('id', ids)
      .eq('user_id', auth.user.id)
      .select('id')

    if (error) {
      return json(500, { ok: false, error: 'DELETE_FAILED', details: error.message })
    }

    const deleted = Array.isArray(data) ? data.length : 0

    return json(200, {
      ok: true,
      deleted,
      requested: ids.length,
    })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
