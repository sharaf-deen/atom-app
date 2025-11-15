// src/app/api/debug/profile/route.ts
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'


export async function GET() {
  try {
    const supa = createSupabaseServerActionClient()

    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) {
      const res = NextResponse.json({ ok: false, error: authErr.message }, { status: 500 })
      res.headers.set('Cache-Control', 'no-store')
      return res
    }

    if (!auth.user) {
      const res = NextResponse.json({ ok: true, auth: null, profile: null })
      res.headers.set('Cache-Control', 'no-store')
      return res
    }

    const { data: prof, error: profErr } = await supa
      .from('profiles')
      .select('user_id,email,role,qr_code,first_name,last_name')
      .eq('user_id', auth.user.id)
      .maybeSingle()

    const res = NextResponse.json({
      ok: true,
      auth: { id: auth.user.id, email: auth.user.email ?? null },
      profile: prof ?? null,
      error: profErr?.message ?? null,
    })
    res.headers.set('Cache-Control', 'no-store')
    return res
  } catch (e: any) {
    const res = NextResponse.json(
      { ok: false, error: e?.message ?? 'SERVER_ERROR' },
      { status: 500 }
    )
    res.headers.set('Cache-Control', 'no-store')
    return res
  }
}
