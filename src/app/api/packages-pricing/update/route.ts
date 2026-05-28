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

function json(status: number, body: any) {
  return noStore(NextResponse.json(body, { status }))
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(v)
}

function toInt(v: any, def: number) {
  const n = Number(v)
  if (!Number.isFinite(n)) return def
  return Math.floor(n)
}

function sanitizeBenefits(v: any) {
  const arr = Array.isArray(v) ? v : []

  const out: string[] = []
  for (const raw of arr) {
    const text = String(raw ?? '')
      .replace(/^[-•*]\s*/, '')
      .trim()
      .slice(0, 120)

    if (!text) continue
    if (out.includes(text)) continue
    out.push(text)
    if (out.length >= 8) break
  }

  return out
}

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()
    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) return json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle<{ role: string | null }>()

    if (meErr) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message })
    if (me?.role !== 'super_admin') return json(403, { ok: false, error: 'FORBIDDEN' })

    let body: any = null
    try {
      body = await req.json()
    } catch {
      body = null
    }

    const id = String(body?.id || '')
    const patch = body?.patch ?? null
    if (!id || !isUuid(id)) return json(400, { ok: false, error: 'INVALID_ID' })
    if (!patch || typeof patch !== 'object') return json(400, { ok: false, error: 'INVALID_PATCH' })

    const update: any = {
      updated_at: new Date().toISOString(),
      updated_by: auth.user.id,
    }

    if (patch.name !== undefined) {
      const name = String(patch.name || '').trim()
      if (!name) return json(400, { ok: false, error: 'INVALID_NAME' })
      update.name = name.slice(0, 80)
    }

    if (patch.type !== undefined) {
      const type = String(patch.type || '')
      if (!['membership', 'private'].includes(type)) return json(400, { ok: false, error: 'INVALID_TYPE' })
      update.type = type
    }

    if (patch.unit !== undefined) {
      const unit = String(patch.unit || '')
      if (!['month', 'session'].includes(unit)) return json(400, { ok: false, error: 'INVALID_UNIT' })
      update.unit = unit
    }

    if (patch.qty !== undefined) {
      const qty = toInt(patch.qty, 1)
      if (qty < 1) return json(400, { ok: false, error: 'INVALID_QTY' })
      update.qty = qty
    }

    if (patch.price_egp !== undefined) {
      const price = toInt(patch.price_egp, 0)
      if (price < 0) return json(400, { ok: false, error: 'INVALID_PRICE' })
      update.price_egp = price
    }

    if (patch.is_active !== undefined) {
      update.is_active = !!patch.is_active
    }

    if (patch.benefits !== undefined) {
      update.benefits = sanitizeBenefits(patch.benefits)
    }

    const meaningfulKeys = Object.keys(update).filter((key) => key !== 'updated_at' && key !== 'updated_by')
    if (meaningfulKeys.length === 0) return json(400, { ok: false, error: 'NOTHING_TO_UPDATE' })

    const admin = createSupabaseAdminClient()
    const { data: item, error } = await admin
      .from('packages_pricing')
      .update(update)
      .eq('id', id)
      .select('id,name,type,unit,qty,price_egp,is_active,benefits')
      .maybeSingle()

    if (error) return json(500, { ok: false, error: 'UPDATE_FAILED', details: error.message })
    if (!item) return json(404, { ok: false, error: 'NOT_FOUND' })

    return json(200, { ok: true, item })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
