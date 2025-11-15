// src/app/api/notifications/sent/list/route.ts
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
  user_id: string | null   // destinataire
}

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

export async function GET(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    // Auth
    const { data: auth } = await supa.auth.getUser()
    const user = auth.user
    if (!user) return noStore(NextResponse.json({ ok:false, error:'NOT_AUTHENTICATED' }, { status:401 }))

    // Rôle
    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle<{ role: string | null }>()
    if (meErr) return noStore(NextResponse.json({ ok:false, error:'PROFILE_LOOKUP_FAILED', details: meErr.message }, { status:500 }))
    if (!me?.role || !['admin','super_admin'].includes(me.role)) {
      return noStore(NextResponse.json({ ok:false, error:'FORBIDDEN' }, { status:403 }))
    }

    // Params
    const { searchParams } = new URL(req.url)
    const page = Math.max(1, Number(searchParams.get('page') || 1))
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 20)))
    const kind = (searchParams.get('kind') || '').trim()
    const q = (searchParams.get('q') || '').trim()

    // Query (mes messages envoyés)
    let qy = supa
      .from('notifications')
      .select('id, title, body, kind, created_at, read_at, user_id', { count: 'exact' })
      .eq('created_by', user.id)
      .order('created_at', { ascending: false })

    if (kind && kind !== 'all') qy = qy.eq('kind', kind)
    if (q) qy = qy.or(`title.ilike.%${q}%,body.ilike.%${q}%`)

    const from = (page - 1) * limit
    const to = from + limit - 1
    const { data, error, count } = await qy.range(from, to)
    if (error) {
      return noStore(NextResponse.json({ ok:false, error:'QUERY_FAILED', details: error.message }, { status:500 }))
    }

    const items = (data ?? []) as Row[]

    // Résoudre destinataires → profiles (nom + email)
    const ids = Array.from(new Set(items.map((r) => r.user_id).filter(Boolean))) as string[]
    let map = new Map<string, { name: string; email: string | null }>()
    if (ids.length > 0) {
      const { data: profs, error: pe } = await supa
        .from('profiles')
        .select('user_id, first_name, last_name, email')
        .in('user_id', ids)
      if (!pe) {
        for (const p of profs ?? []) {
          const name = [p.first_name ?? '', p.last_name ?? ''].join(' ').trim()
          map.set(p.user_id, { name: name || (p.email ?? ''), email: p.email ?? null })
        }
      }
    }

    const enriched = items.map((r) => {
      const info = r.user_id ? map.get(r.user_id) : undefined
      return {
        ...r,
        recipient_name: info?.name ?? (r.user_id ?? '—'),
        recipient_email: info?.email ?? null,
      }
    })

    return noStore(NextResponse.json({
      ok: true,
      page,
      pageSize: limit,
      total: count ?? 0,
      items: enriched,
    }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok:false, error: e?.message || 'SERVER_ERROR' }, { status:500 }))
  }
}
