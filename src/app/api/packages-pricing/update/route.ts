export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
}

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()
    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) return noStore(NextResponse.json({ ok: false, error: 'AUTH_ERROR', details: authErr.message }, { status: 401 }))
    if (!auth.user) return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))

    // Role check (super_admin only)
    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle<{ role: string | null }>()

    if (meErr) return noStore(NextResponse.json({ ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message }, { status: 500 }))
    if (me?.role !== 'super_admin') return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))

    let body: any = null
    try {
      body = await req.json()
    } catch {
      body = null
    }

    const id = String(body?.id || '')
    const patch = body?.patch ?? null
    if (!id || !isUuid(id)) return noStore(NextResponse.json({ ok: false, error: 'INVALID_ID' }, { status: 400 }))
    if (!patch || typeof patch !== 'object') return noStore(NextResponse.json({ ok: false, error: 'INVALID_PATCH' }, { status: 400 }))

    const update: any = {}
    if (patch.title !== undefined) {
      const t = String(patch.title || '').trim()
      if (!t) return noStore(NextResponse.json({ ok: false, error: 'INVALID_TITLE' }, { status: 400 }))
      update.title = t.slice(0, 80)
    }
    if (patch.price_egp !== undefined) {
      const n = Number(patch.price_egp)
      if (!Number.isFinite(n) || n < 0) return noStore(NextResponse.json({ ok: false, error: 'INVALID_PRICE' }, { status: 400 }))
      update.price_egp = Math.floor(n)
    }
    if (patch.sort_order !== undefined) {
      const n = Number(patch.sort_order)
      if (!Number.isFinite(n) || n < 0) return noStore(NextResponse.json({ ok: false, error: 'INVALID_SORT_ORDER' }, { status: 400 }))
      update.sort_order = Math.floor(n)
    }
    if (patch.is_active !== undefined) {
      update.is_active = !!patch.is_active
    }

    if (Object.keys(update).length === 0) {
      return noStore(NextResponse.json({ ok: false, error: 'NOTHING_TO_UPDATE' }, { status: 400 }))
    }

    const admin = createSupabaseAdminClient()
    const { data: item, error } = await admin
      .from('packages_pricing')
      .update(update)
      .eq('id', id)
      .select('id,title,price_egp,sort_order,is_active')
      .maybeSingle()

    if (error) return noStore(NextResponse.json({ ok: false, error: 'UPDATE_FAILED', details: error.message }, { status: 500 }))
    if (!item) return noStore(NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 }))

    return noStore(NextResponse.json({ ok: true, item }, { status: 200 }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) }, { status: 500 }))
  }
}
