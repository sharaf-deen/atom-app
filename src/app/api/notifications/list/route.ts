// src/app/api/notifications/list/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { clampInt, isSimpleKey, sanitizeSearch } from '@/lib/inputGuard'

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

export async function GET(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) return json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const url = new URL(req.url)
    const page = clampInt(url.searchParams.get('page'), 1, 1, 10_000)
    const limit = clampInt(url.searchParams.get('limit'), 5, 1, 50)
    const kindRaw = sanitizeSearch(url.searchParams.get('kind'), { max: 32 }).toLowerCase()
    const q = sanitizeSearch(url.searchParams.get('q'), { max: 80 })
    const unread = url.searchParams.get('unread') === '1'

    const kind = !kindRaw || kindRaw === 'all' ? '' : kindRaw
    if (kind && !isSimpleKey(kind, 32)) {
      return json(400, { ok: false, error: 'INVALID_KIND' })
    }

    const from = (page - 1) * limit
    const to = from + limit - 1

    let qy = supa
      .from('notifications')
      .select('id,title,body,kind,created_at,read_at,created_by', { count: 'exact' })
      .eq('user_id', auth.user.id)
      .is('deleted_for_user_at', null)
      .order('created_at', { ascending: false })
      .range(from, to)

    if (unread) qy = qy.is('read_at', null)
    if (kind) qy = qy.eq('kind', kind)

    if (q) {
      const esc = q.replace(/%/g, '\\%').replace(/_/g, '\\_')
      qy = qy.or(`title.ilike.%${esc}%,body.ilike.%${esc}%`)
    }

    const { data, error, count } = await qy
    if (error) return json(500, { ok: false, error: 'QUERY_FAILED', details: error.message })

    return json(200, {
      ok: true,
      items: Array.isArray(data) ? data : [],
      total: Number(count || 0),
      page,
      limit,
    })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
