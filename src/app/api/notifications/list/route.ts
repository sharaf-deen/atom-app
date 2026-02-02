export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

function json(status: number, body: any) {
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

type NotifRow = {
  id: string
  title: string | null
  body: string
  kind: string | null
  created_at: string
  read_at?: string | null
}

const STAFF_ROLES = new Set(['admin', 'super_admin', 'coach', 'assistant_coach', 'reception'])

/**
 * GET /api/notifications/list
 *
 * Default: returns current user's notifications (member-friendly).
 * Optional: staff can request all notifications with ?all=1 (requires staff role).
 *
 * Query params:
 * - page (default 1)
 * - limit (default 5, max 50)
 * - kind (optional, 'all' or specific)
 * - q (optional search in title/body)
 * - unread (optional '1' to return only unread)
 * - all (optional '1' for staff to list everything; members get FORBIDDEN)
 */
export async function GET(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    // Auth
    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) return json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const url = new URL(req.url)
    const page = intParam(url.searchParams.get('page'), 1, 1, 10_000)
    const limit = intParam(url.searchParams.get('limit'), 5, 1, 50)
    const kind = (url.searchParams.get('kind') || '').trim()
    const q = cleanQ(url.searchParams.get('q'))
    const unread = (url.searchParams.get('unread') || '').trim() === '1'
    const wantAll = (url.searchParams.get('all') || '').trim() === '1'

    // Role (only needed when wantAll=1)
    let role: string | null = null
    if (wantAll) {
      const { data: me, error: meErr } = await supa
        .from('profiles')
        .select('role')
        .eq('user_id', auth.user.id)
        .maybeSingle()

      if (meErr) return json(500, { ok: false, error: 'PROFILE_ERROR', details: meErr.message })

      role = (me?.role ?? 'member') as string
      if (!STAFF_ROLES.has(role)) {
        return json(403, { ok: false, error: 'FORBIDDEN' })
      }
    }

    const from = (page - 1) * limit
    const to = from + limit - 1

    // Base query (RLS should enforce ownership/staff visibility)
    let qy = supa
      .from('notifications')
      .select('id,title,body,kind,created_at,read_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)

    // Default behavior: member sees only their notifications
    if (!wantAll) {
      qy = qy.eq('user_id', auth.user.id)
    }

    if (unread) qy = qy.is('read_at', null)
    if (kind && kind !== 'all') qy = qy.eq('kind', kind)

    if (q) {
      const esc = q.replace(/%/g, '\\%').replace(/_/g, '\\_')
      qy = qy.or(`title.ilike.%${esc}%,body.ilike.%${esc}%`)
    }

    const { data, error, count } = await qy
    if (error) {
      // Most common cause: RLS / permission issue.
      // We keep status=403 to match the UI "FORBIDDEN" banner, but include details for debugging.
      return json(403, { ok: false, error: 'FORBIDDEN', details: error.message })
    }

    const rows = (Array.isArray(data) ? data : []) as NotifRow[]

    return json(200, {
      ok: true,
      page,
      limit,
      total: Number(count || 0),
      items: rows,
    })
  } catch (e: any) {
    console.error('notifications/list error:', e)
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
