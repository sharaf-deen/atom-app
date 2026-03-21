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

type Body = { ids?: string[] }

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'AUTH_ERROR', details: authErr.message }, { status: 401 }),
      )
    }

    const user = auth.user
    if (!user) {
      return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))
    }

    const body = (await req.json()) as Body
    const ids = Array.isArray(body?.ids) ? body.ids.map((s) => String(s || '').trim()).filter(Boolean) : []
    if (ids.length === 0) {
      return noStore(NextResponse.json({ ok: false, error: 'NO_IDS' }, { status: 400 }))
    }

    const { error } = await supa
      .from('notifications')
      .update({ read_at: null })
      .eq('user_id', user.id)
      .in('id', ids)

    if (error) {
      return noStore(
        NextResponse.json({ ok: false, error: 'UPDATE_FAILED', details: error.message }, { status: 500 }),
      )
    }

    return noStore(NextResponse.json({ ok: true, count: ids.length }))
  } catch (e: any) {
    return noStore(
      NextResponse.json(
        { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) },
        { status: 500 },
      ),
    )
  }
}
