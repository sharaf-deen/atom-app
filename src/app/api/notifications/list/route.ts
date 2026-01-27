// src/app/api/notifications/sent/list/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
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
  created_by: string | null
  user_id: string
}

type ProfileMini = {
  user_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  role: string | null
}

type Batch = {
  id: string
  title: string | null
  body: string
  kind: string | null
  created_at: string
  recipient_ids: string[]
  recipient_name?: string
  recipient_email?: string | null
  recipient_count: number
}

function bucket10s(iso: string) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 0
  return Math.floor(t / 10_000) * 10_000
}

function sha1(s: string) {
  return createHash('sha1').update(s).digest('hex')
}

function displayName(p?: ProfileMini | null) {
  if (!p) return '-'
  const fn = (p.first_name || '').trim()
  const ln = (p.last_name || '').trim()
  const full = (fn + ' ' + ln).trim()
  return full || (p.email || '').trim() || '-'
}

async function countRole(admin: any, role: string) {
  const { count, error } = await admin
    .from('profiles')
    .select('user_id', { head: true, count: 'exact' })
    .eq('role', role)
  if (error) return 0
  return Number(count || 0)
}

async function fetchProfilesByIds(admin: any, ids: string[]) {
  const out = new Map<string, ProfileMini>()
  const uniq = Array.from(new Set(ids)).filter(Boolean)
  const CHUNK = 800
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const slice = uniq.slice(i, i + CHUNK)
    const { data, error } = await admin
      .from('profiles')
      .select('user_id,email,first_name,last_name,role')
      .in('user_id', slice)
    if (!error && Array.isArray(data)) {
      for (const r of data as any[]) out.set(String(r.user_id), r as ProfileMini)
    }
  }
  return out
}

export async function GET(req: Request) {
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
    if (role !== 'admin' && role !== 'super_admin') {
      return json(403, { ok: false, error: 'FORBIDDEN' })
    }

    const url = new URL(req.url)
    const page = intParam(url.searchParams.get('page'), 1, 1, 10_000)
    const limit = intParam(url.searchParams.get('limit'), 5, 1, 50)
    const kind = (url.searchParams.get('kind') || '').trim()
    const q = cleanQ(url.searchParams.get('q'))

    const admin = makeAdminClient()
    if (!admin) {
      return json(500, {
        ok: false,
        error: 'SERVICE_ROLE_MISSING',
        details: 'SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL) must be set on the server.',
      })
    }

    const MAX_ROWS = 5000

    // base query
    let qy = admin
      .from('notifications')
      .select('id,title,body,kind,created_at,created_by,user_id', { count: 'exact' })
      .eq('created_by', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS)

    if (kind && kind !== 'all') qy = qy.eq('kind', kind)
    if (q) {
      const esc = q.replace(/%/g, '\\%').replace(/_/g, '\\_')
      qy = qy.or(`title.ilike.%${esc}%,body.ilike.%${esc}%`)
    }

    const { data, error, count: rowCount } = await qy
    if (error) return json(500, { ok: false, error: 'QUERY_FAILED', details: error.message })

    const rows = (Array.isArray(data) ? data : []) as NotifRow[]

    // Group into batches by (created_by, kind, title, body, 10s bucket)
    const batches: Batch[] = []
    const seen = new Map<string, Batch>()

    for (const r of rows) {
      const b = bucket10s(r.created_at)
      const rawKey = `${r.created_by || ''}|${r.kind || ''}|${r.title || ''}|${r.body}|${b}`
      const key = sha1(rawKey)

      let batch = seen.get(key)
      if (!batch) {
        batch = {
          id: key,
          title: r.title ?? null,
          body: r.body,
          kind: r.kind ?? null,
          created_at: r.created_at,
          recipient_ids: [],
          recipient_count: 0,
        }
        seen.set(key, batch)
        batches.push(batch)
      }
      batch.recipient_ids.push(String(r.user_id))
      batch.recipient_count++
    }

    // Build role-aware labels
    const allMembers = await countRole(admin, 'member')
    const allCoaches = await countRole(admin, 'coach')
    const allAssist = await countRole(admin, 'assistant_coach')

    const allRecipientIds = batches.flatMap((b) => b.recipient_ids)
    const profiles = await fetchProfilesByIds(admin, allRecipientIds)

    for (const b of batches) {
      const roles = b.recipient_ids.map((id) => profiles.get(id)?.role ?? null)
      const count = b.recipient_count

      const allSame = (target: string) => roles.length > 0 && roles.every((r) => r === target)

      if (count > 1 && count === allMembers && allSame('member')) {
        b.recipient_name = 'All members'
      } else if (count > 1 && count === allCoaches && allSame('coach')) {
        b.recipient_name = 'All coaches'
      } else if (count > 1 && count === allAssist && allSame('assistant_coach')) {
        b.recipient_name = 'All assistant coaches'
      } else if (count === 1) {
        const p = profiles.get(b.recipient_ids[0])
        b.recipient_name = displayName(p)
        b.recipient_email = p?.email ?? null
      } else {
        b.recipient_name = `Custom (${count})`
        b.recipient_email = null
      }
    }

    // Pagination on batches
    const offset = (page - 1) * limit
    const slice = batches.slice(offset, offset + limit)

    // Total batches found in current window.
    // If there are more rows than MAX_ROWS, total can be underestimated;
    // keep Next enabled by ensuring total is at least (offset+limit+1) when rowCount is large.
    let total = batches.length
    if (Number(rowCount || 0) >= MAX_ROWS && total < offset + limit + 1) {
      total = offset + limit + 1
    }

    return json(200, {
      ok: true,
      page,
      limit,
      total,
      items: slice.map((b) => ({
        id: b.id,
        title: b.title,
        body: b.body,
        kind: b.kind,
        created_at: b.created_at,
        recipient_name: b.recipient_name,
        recipient_email: b.recipient_email ?? null,
        recipient_count: b.recipient_count,
      })),
    })
  } catch (e: any) {
    console.error('notifications/sent/list error:', e)
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
