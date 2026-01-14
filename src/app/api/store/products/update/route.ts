// src/app/api/store/products/update/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/apiAuth'

type Category = 'kimono' | 'rashguard' | 'short' | 'belt'
const CATEGORIES: readonly Category[] = ['kimono', 'rashguard', 'short', 'belt'] as const

function createSupabaseForAPI() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
  const key = serviceKey || anon
  if (!key) throw new Error('Missing SUPABASE keys')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  try {
    const body = await req.json().catch(() => ({}))
    const id = String(body?.id || '').trim()
    if (!id) {
      return NextResponse.json({ ok: false, error: 'Missing product id' }, { status: 400 })
    }

    // Validation légère + construction du payload
    const payload: Record<string, any> = {}

    if (body.category !== undefined) {
      const cat = String(body.category) as Category
      if (!CATEGORIES.includes(cat)) {
        return NextResponse.json({ ok: false, error: 'Invalid category' }, { status: 400 })
      }
      payload.category = cat
    }

    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (!name) return NextResponse.json({ ok: false, error: 'Name cannot be empty' }, { status: 400 })
      if (name.length > 200) return NextResponse.json({ ok: false, error: 'Name too long' }, { status: 400 })
      payload.name = name
    }

    if (body.color !== undefined) {
      payload.color = body.color === null ? null : String(body.color).trim()
    }
    if (body.size !== undefined) {
      payload.size = body.size === null ? null : String(body.size).trim()
    }

    if (body.price_cents !== undefined) {
      const centsNum = Number(body.price_cents)
      if (!Number.isFinite(centsNum) || centsNum < 0) {
        return NextResponse.json({ ok: false, error: 'Invalid price_cents' }, { status: 400 })
      }
      payload.price_cents = Math.floor(centsNum)
    }

    if (body.inventory_qty !== undefined) {
      const inv = Number(body.inventory_qty)
      if (!Number.isFinite(inv) || inv < 0) {
        return NextResponse.json({ ok: false, error: 'Invalid inventory_qty' }, { status: 400 })
      }
      payload.inventory_qty = Math.floor(inv)
    }

    if (body.is_active !== undefined) {
      if (typeof body.is_active !== 'boolean') {
        return NextResponse.json({ ok: false, error: 'is_active must be boolean' }, { status: 400 })
      }
      payload.is_active = body.is_active
    }

    // rien à mettre à jour ?
    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ ok: false, error: 'No fields to update' }, { status: 400 })
    }

    const supabase = createSupabaseForAPI()

    const { data, error } = await supabase
      .from('store_products')
      .update(payload)
      .eq('id', id)
      .select('id, category, name, color, size, price_cents, currency, inventory_qty, is_active, created_at')
      .single()

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, item: data })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
