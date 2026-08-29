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

function normalizePackageId(v: any) {
  const id = String(v ?? '').trim()
  if (!id) return ''
  if (id === 'undefined' || id === 'null' || id === '[object Object]') return ''
  return id.slice(0, 140)
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

type PackageLookup = {
  name: string
  type: 'membership' | 'private'
  unit: 'week' | 'month' | 'session'
  qty: number
  price_egp: number | null
}

function normalizeLookup(raw: any): PackageLookup | null {
  if (!raw || typeof raw !== 'object') return null

  const name = String(raw.name ?? '').trim()
  const type = String(raw.type ?? '')
  const unit = String(raw.unit ?? '')
  const qty = toInt(raw.qty, 0)
  const priceRaw = raw.price_egp
  const price = priceRaw === undefined || priceRaw === null || priceRaw === '' ? null : toInt(priceRaw, -1)

  if (!name) return null
  if (!['membership', 'private'].includes(type)) return null
  if (!['week', 'month', 'session'].includes(unit)) return null
  if (qty < 1) return null
  if (price !== null && price < 0) return null

  return {
    name: name.slice(0, 80),
    type: type as PackageLookup['type'],
    unit: unit as PackageLookup['unit'],
    qty,
    price_egp: price,
  }
}

async function findPackageIdByLookup(admin: any, lookup: PackageLookup) {
  let query = admin
    .from('packages_pricing')
    .select('id')
    .eq('name', lookup.name)
    .eq('type', lookup.type)
    .eq('unit', lookup.unit)
    .eq('qty', lookup.qty)
    .limit(2)

  if (lookup.price_egp !== null) {
    query = query.eq('price_egp', lookup.price_egp)
  }

  const { data, error } = await query

  if (error) return { id: '', error, ambiguous: false, found: false }
  if (!Array.isArray(data) || data.length === 0) return { id: '', error: null, ambiguous: false, found: false }
  if (data.length > 1) return { id: '', error: null, ambiguous: true, found: true }

  return { id: normalizePackageId(data[0]?.id), error: null, ambiguous: false, found: true }
}

async function updatePackageById(admin: any, id: string, update: any) {
  return admin
    .from('packages_pricing')
    .update(update)
    .eq('id', id)
    .select('id,name,type,unit,qty,price_egp,is_active,benefits')
    .maybeSingle()
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

    const id = normalizePackageId(body?.id ?? body?.package_id ?? body?.entry_id)
    const lookup = normalizeLookup(body?.lookup ?? body?.original ?? body?.package)
    const patch = body?.patch ?? null

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
      if (!['week', 'month', 'session'].includes(unit)) return json(400, { ok: false, error: 'INVALID_UNIT' })
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
    let lastError: any = null

    if (id) {
      const { data: item, error } = await updatePackageById(admin, id, update)

      if (error) {
        lastError = error
      } else if (item) {
        return json(200, { ok: true, item })
      }
    }

    if (!lookup) {
      return json(400, {
        ok: false,
        error: 'INVALID_PACKAGE_TARGET',
        details: lastError?.message || 'Missing package target. Please refresh Packages & Promos and try again.',
      })
    }

    const resolved = await findPackageIdByLookup(admin, lookup)

    if (resolved.error) {
      return json(500, { ok: false, error: 'PACKAGE_LOOKUP_FAILED', details: resolved.error.message })
    }

    if (resolved.ambiguous) {
      return json(409, {
        ok: false,
        error: 'AMBIGUOUS_PACKAGE_TARGET',
        details: 'More than one package matched this row. Please refresh Packages & Promos and try again.',
      })
    }

    if (!resolved.id) {
      return json(404, {
        ok: false,
        error: 'PACKAGE_NOT_FOUND',
        details: 'Package not found. Please refresh Packages & Promos and try again.',
      })
    }

    const { data: item, error } = await updatePackageById(admin, resolved.id, update)

    if (error) return json(500, { ok: false, error: 'UPDATE_FAILED', details: error.message })
    if (!item) return json(404, { ok: false, error: 'NOT_FOUND' })

    return json(200, { ok: true, item })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
