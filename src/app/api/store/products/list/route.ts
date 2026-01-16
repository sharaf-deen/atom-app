export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireUser } from '@/lib/apiAuth'

type Category = 'kimono' | 'rashguard' | 'short' | 'belt'
type Role = 'member' | 'assistant_coach' | 'coach' | 'reception' | 'admin' | 'super_admin'

function createSupabaseForAPI() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
  if (!anon) throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY')

  // ✅ On utilise ANON côté serveur ici : RLS fera le job (lecture autorisée seulement si auth cookie)
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function GET(req: NextRequest) {
  const gate = await requireUser()
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
    const wantAll = searchParams.get('all') === '1'

    // ✅ Seul super_admin peut demander all=1
    const role = (gate.user.role as Role) || 'member'
    const isSuperAdmin = role === 'super_admin'
    const all = wantAll && isSuperAdmin

    let q = supabase
      .from('store_products')
      .select(
        'id, category, name, color, size, price_cents, currency, inventory_qty, is_active, created_at',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })

    // Par défaut on ne montre que les actifs (super_admin peut demander all=1)
    if (!all) q = q.eq('is_active', true)

    // Filtre actif/inactif (autorisé seulement si super_admin)
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
