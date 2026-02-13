export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

function noStore(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function intParam(v: string | null, def: number, min: number, max: number) {
  const n = Number(v || '')
  if (!Number.isFinite(n)) return def
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function cleanQ(v: string | null) {
  const s = (v || '').trim()
  if (!s) return ''
  // prevent Supabase `or()` parsing issues (commas separate conditions)
  return s.slice(0, 80).replace(/[,]/g, ' ').trim()
}

export async function GET(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    // Auth
    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) return noStore(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message })
    if (!auth.user) return noStore(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    // Role
    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle<{ role: string | null }>()

    if (meErr) return noStore(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message })
    if (!me?.role || !['admin', 'super_admin'].includes(me.role)) {
      return noStore(403, { ok: false, error: 'FORBIDDEN' })
    }

    const url = new URL(req.url)
    const page = intParam(url.searchParams.get('page'), 1, 1, 10_000)
    const limit = intParam(url.searchParams.get('limit'), 5, 1, 50)
    const q = cleanQ(url.searchParams.get('q'))
    const unread = url.searchParams.get('unread') === '1'

    const from = (page - 1) * limit
    const to = from + limit - 1

    // Member messages are notifications of kind 'member_contact' addressed to this admin.
    let qy = supa
      .from('notifications')
      .select('id,title,body,kind,created_at,read_at,created_by', { count: 'exact' })
      .eq('user_id', auth.user.id)
      .eq('kind', 'member_contact')
      .is('deleted_for_user_at', null)
      .order('created_at', { ascending: false })
      .range(from, to)

    if (unread) qy = qy.is('read_at', null)

    if (q) {
      const esc = q.replace(/%/g, '\\%').replace(/_/g, '\\_')
      qy = qy.or(`title.ilike.%${esc}%,body.ilike.%${esc}%`)
    }

    const { data, error, count } = await qy
    if (error) return noStore(500, { ok: false, error: 'QUERY_FAILED', details: error.message })

    const items = Array.isArray(data) ? data : []

    // Resolve senders (created_by) → profiles
    const senderIds = Array.from(new Set(items.map((r: any) => r.created_by).filter(Boolean))) as string[]
    const map = new Map<string, { name: string; email: string | null }>()

    if (senderIds.length > 0) {
      const { data: profs, error: pe } = await supa
        .from('profiles')
        .select('user_id, first_name, last_name, email')
        .in('user_id', senderIds)

      if (!pe) {
        for (const p of profs ?? []) {
          const name = [p.first_name ?? '', p.last_name ?? ''].join(' ').trim()
          map.set(p.user_id, { name: name || (p.email ?? ''), email: p.email ?? null })
        }
      }
    }

    const enriched = items.map((r: any) => {
      const info = r.created_by ? map.get(r.created_by) : undefined
      return {
        ...r,
        sender_name: info?.name ?? (r.created_by ?? '—'),
        sender_email: info?.email ?? null,
      }
    })

    return noStore(200, {
      ok: true,
      items: enriched,
      total: Number(count || 0),
      page,
      limit,
    })
  } catch (e: any) {
    return noStore(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
