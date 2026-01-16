export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/apiAuth'
import { createSupabaseRSC } from '@/lib/supabaseServer'

type Role = 'member' | 'assistant_coach' | 'coach' | 'reception' | 'admin' | 'super_admin'
type Category = 'kimono' | 'rashguard' | 'short' | 'belt'

export async function GET(req: NextRequest) {
  const gate = await requireUser()
  if (!gate.ok) return gate.res

  try {
    // ✅ IMPORTANT: client server avec cookies => rôle = authenticated
    const supabase = createSupabaseRSC()

    const { searchParams } = new URL(req.url)

    const pageRaw = Number(searchParams.get('page') || 1)
    const limitRaw = Number(searchParams.get('limit') || 10)
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.floor(limitRaw))) : 10
    const start = (page - 1) * limit
    const end = start + limit - 1

    const category = (searchParams.get('category') || '') as Category | ''
    const wantAll = searchParams.get('all') === '1'
    const active = searchParams.get('active') // '1' | '0' | null

    const role = (gate.user.role as Role) || 'member'
    const isSuperAdmin = role === 'super_admin'

    // ✅ all=1 ou active=0 : super_admin uniquement
    const all = wantAll && isSuperAdmin

    let q = supabase
      .from('store_products')
      .select(
        'id,category,name,color,size,price_cents,currency,inventory_qty,is_active,created_at,updated_at',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })

    // Par défaut: produits actifs seulement
    if (!all) q = q.eq('is_active', true)

    if (active === '1') q = q.eq('is_active', true)
    if (active === '0') {
      if (!isSuperAdmin) {
        return NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 })
      }
      q = q.eq('is_active', false)
    }

    if (category) q = q.eq('category', category)

    q = q.range(start, end)

    const { data, count, error } = await q
    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500, headers: { 'Cache-Control': 'no-store' } }
      )
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
