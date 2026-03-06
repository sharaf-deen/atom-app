import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseRouteClient } from '@/lib/supabaseRoute'

const STAFF_ROLES = new Set(['reception', 'admin', 'super_admin'])

export async function GET(req: NextRequest) {
  const { supabase, applyCookies } = createSupabaseRouteClient(req)

  try {
    const { data: userRes, error: userErr } = await supabase.auth.getUser()
    if (userErr || !userRes?.user) {
      return applyCookies(
        NextResponse.json(
          { ok: false, reason: 'unauthenticated' },
          { status: 401, headers: { 'cache-control': 'no-store' } }
        )
      )
    }

    const user = userRes.user

    const { data: prof, error: profErr } = await supabase
      .from('profiles')
      .select('role,email')
      .eq('user_id', user.id)
      .maybeSingle()

    const role = (prof?.role ?? null) as string | null
    const email = (prof?.email ?? user.email ?? null) as string | null

    if (profErr) {
      return applyCookies(
        NextResponse.json(
          { ok: false, reason: 'profile_error' },
          { status: 500, headers: { 'cache-control': 'no-store' } }
        )
      )
    }

    if (!role || !STAFF_ROLES.has(role)) {
      return applyCookies(
        NextResponse.json(
          { ok: false, reason: 'forbidden', role },
          { status: 403, headers: { 'cache-control': 'no-store' } }
        )
      )
    }

    // Optional: include session expiry if available
    const { data: sessRes } = await supabase.auth.getSession()
    const expiresAt = sessRes?.session?.expires_at ?? null

    return applyCookies(
      NextResponse.json(
        {
          ok: true,
          role,
          email,
          user_id: user.id,
          expires_at: expiresAt,
          ts: new Date().toISOString(),
        },
        { status: 200, headers: { 'cache-control': 'no-store' } }
      )
    )
  } catch {
    return applyCookies(
      NextResponse.json(
        { ok: false, reason: 'unexpected' },
        { status: 500, headers: { 'cache-control': 'no-store' } }
      )
    )
  }
}
