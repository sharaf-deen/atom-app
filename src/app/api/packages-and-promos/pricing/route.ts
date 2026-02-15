export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function json(status: number, body: any) {
  return noStore(NextResponse.json(body, { status }))
}

function sanitizePricing(v: any) {
  if (!v || typeof v !== 'object') return null

  const str = (x: any) => String(x ?? '').trim()
  const arr = (x: any) => (Array.isArray(x) ? x : [])

  const memberships = arr(v.memberships)
    .map((r: any) => ({ label: str(r?.label), price: str(r?.price) }))
    .filter((r: any) => r.label && r.price)

  const dropIn = arr(v.dropIn)
    .map((r: any) => ({ label: str(r?.label), price: str(r?.price || ''), note: str(r?.note || '') }))
    .filter((r: any) => r.label)
    .map((r: any) => ({
      label: r.label,
      ...(r.price ? { price: r.price } : {}),
      ...(r.note ? { note: r.note } : {}),
    }))

  const privateTraining = arr(v.privateTraining)
    .map((r: any) => ({ label: str(r?.label), price: str(r?.price || '') }))
    .filter((r: any) => r.label)
    .map((r: any) => ({ label: r.label, ...(r.price ? { price: r.price } : {}) }))

  return {
    memberships,
    dropIn,
    privateTraining,
  }
}

export async function GET() {
  try {
    const supa = createSupabaseServerActionClient()
    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) return json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const { data, error } = await supa.from('packages_pricing').select('pricing, updated_at, updated_by').eq('id', 1).maybeSingle()
    if (error) return json(500, { ok: false, error: 'QUERY_FAILED', details: error.message })

    return json(200, { ok: true, pricing: data?.pricing ?? null, updated_at: data?.updated_at ?? null })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()
    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) return json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message })
    const user = auth.user
    if (!user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    // role check
    const { data: me, error: meErr } = await supa.from('profiles').select('role').eq('user_id', user.id).maybeSingle<{ role: string | null }>()
    if (meErr) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message })
    if (me?.role !== 'super_admin') return json(403, { ok: false, error: 'FORBIDDEN' })

    let body: any = null
    try {
      body = await req.json()
    } catch {
      body = null
    }

    const pricing = sanitizePricing(body?.pricing)
    if (!pricing) return json(400, { ok: false, error: 'INVALID_BODY' })

    const { error } = await supa
      .from('packages_pricing')
      .upsert({ id: 1, pricing, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: 'id' })

    if (error) return json(500, { ok: false, error: 'UPDATE_FAILED', details: error.message })

    return json(200, { ok: true })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
