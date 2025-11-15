// src/app/api/notifications/list/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'


type Row = {
  id: string
  title: string | null
  body: string
  kind: string | null
  created_at: string
  read_at: string | null
  created_by: string | null
}

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

export async function GET(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    // Auth
    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) {
      return noStore(NextResponse.json({ ok:false, error:'AUTH_ERROR', details: authErr.message }, { status:401 }))
    }
    const user = auth.user
    if (!user) return noStore(NextResponse.json({ ok:false, error:'NOT_AUTHENTICATED' }, { status:401 }))

    // Params
    const { searchParams } = new URL(req.url)
    const page = Math.max(1, Number(searchParams.get('page') || 1))
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 20)))
    const unreadOnly = searchParams.get('unread') === '1'
    const kind = (searchParams.get('kind') || '').trim()
    const q = (searchParams.get('q') || '').trim()

    // Query (RLS: user lit ses propres notifs via user_id = auth.uid())
    let qy = supa
      .from('notifications')
      .select('id, title, body, kind, created_at, read_at, created_by', { count: 'exact' })
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (unreadOnly) qy = qy.is('read_at', null)
    if (kind && kind !== 'all') qy = qy.eq('kind', kind)
    if (q) qy = qy.or(`title.ilike.%${q}%,body.ilike.%${q}%`)

    const from = (page - 1) * limit
    const to = from + limit - 1
    const { data, error, count } = await qy.range(from, to)
    if (error) {
      return noStore(NextResponse.json({ ok:false, error:'QUERY_FAILED', details: error.message }, { status:500 }))
    }

    return noStore(NextResponse.json({
      ok: true,
      page,
      pageSize: limit,
      total: count ?? 0,
      items: (data ?? []) as Row[],
    }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok:false, error: e?.message || 'SERVER_ERROR' }, { status:500 }))
  }
}
