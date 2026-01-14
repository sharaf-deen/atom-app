export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireStaff } from '@/lib/apiAuth'

type Category = 'kimono' | 'rashguard' | 'short' | 'belt'

function createSupabaseForAPI() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
  // ✅ on préfère service key côté serveur (ok car endpoint staff-only)
  const key = serviceKey || anon
  if (!key) throw new Error('Missing SUPABASE keys')

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function GET(req: NextRequest) {
  const gate = await requireStaff()
  if (!gate.ok) return gate.res

  try {
    const supabase = createSupabaseForAPI()
    const { searchParams } = new URL(req.url)

    const pageRaw = Number(searchParams.get('page') || 1)
    const limitRaw = Number(searchParams.get('limit') || 10)
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.floor(limitRaw))) : 10
    const start = (page - 1) * limit
    const end = start + limit - 1

    const category = (searchParams.get('category') || '') as Category | ''
    const active = searchParams.get('active') // '1' | '0' | null
    const all = searchParams.get('all') === '1'

    let q = supabase
      .from('store_products')
      .select(
        'id, category, name, color, size, price_cents, currency, inventory_qty, is_active, created_at',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })

    if (!all) q = q.eq('is_active', true)
    if (active === '1') q = q.eq('is_active', true)
    if (active === '0') q = q.eq('is_active', false)
    if (category) q = q.eq('category', category)

    q = q.range(start, end)

    const { data, count, error } = await q
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json(
      { ok: true, items: data ?? [], total: count ?? 0, page, pageSize: limit },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
