export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

function json(status: number, body: any) {
  return NextResponse.json(body, { status })
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
  const supa = createSupabaseServerActionClient()
  const me = await supa.auth.getUser()
  if (!me.data.user) return json(401, { ok: false, error: 'Not authenticated' })

  const { data: prof } = await supa
    .from('profiles')
    .select('role')
    .eq('user_id', me.data.user.id)
    .maybeSingle<{ role: string | null }>()

  const role = prof?.role ?? 'member'
  if (role !== 'super_admin') return json(403, { ok: false, error: 'Forbidden' })

  let body: any = null
  try {
    body = await req.json()
  } catch {
    body = null
  }

  const item = body?.item ?? null
  if (!item || typeof item !== 'object') return json(400, { ok: false, error: 'Missing item' })

  const name = String(item.name ?? '').trim()
  const type = String(item.type ?? '')
  const unit = String(item.unit ?? '')
  const qty = toInt(item.qty, 1)
  const price_egp = toInt(item.price_egp, 0)
  const is_active = item.is_active === false ? false : true
  const benefits = sanitizeBenefits(item.benefits)

  if (!name) return json(400, { ok: false, error: 'Name is required' })
  if (!['membership', 'private'].includes(type)) return json(400, { ok: false, error: 'Invalid type' })
  if (!['week', 'month', 'session'].includes(unit)) return json(400, { ok: false, error: 'Invalid unit' })
  if (qty < 1) return json(400, { ok: false, error: 'Invalid qty' })
  if (price_egp < 0) return json(400, { ok: false, error: 'Invalid price' })

  const admin = createSupabaseAdminClient()

  const { data, error } = await admin
    .from('packages_pricing')
    .insert({ name, type, unit, qty, price_egp, is_active, benefits, updated_by: me.data.user.id })
    .select('id,name,type,unit,qty,price_egp,is_active,benefits')
    .maybeSingle()

  if (error) return json(500, { ok: false, error: error.message })

  return json(200, { ok: true, item: data })
}
