// src/app/api/store/products/list/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

type Category = 'kimono' | 'rashguard' | 'short' | 'belt'

/**
 * Crée un client Supabase côté serveur.
 * - Si la SERVICE_ROLE_KEY est dispo, on l'utilise (compte de service) => count exact garanti.
 * - Sinon, fallback sur l'ANON KEY en lecture (compte public) — RLS doit être configuré en conséquence.
 */
function createSupabaseForAPI() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')

  const key = serviceKey || anon
  if (!key) throw new Error('Missing SUPABASE keys')

  // ATTENTION: la service role key doit rester côté serveur uniquement
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

export const dynamic = 'force-dynamic' // pour éviter le cache en prod si nécessaire
export const revalidate = 0

export async function GET(req: NextRequest) {
  try {
    const supabase = createSupabaseForAPI()

    const { searchParams } = new URL(req.url)

    // Pagination sécurisée
    const pageRaw = Number(searchParams.get('page') || 1)
    const limitRaw = Number(searchParams.get('limit') || 10)
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.floor(limitRaw))) : 10
    const start = (page - 1) * limit
    const end = start + limit - 1

    // Filtres
    const category = (searchParams.get('category') || '') as Category | ''
    const active = searchParams.get('active') // '1' | '0' | null
    const all = searchParams.get('all') === '1' // quand true, on ne force pas is_active=true par défaut

    // Base query
    // NOTE: si vous avez besoin de champs additionnels, adaptez la liste des colonnes.
    let q = supabase
      .from('store_products')
      .select(
        'id, category, name, color, size, price_cents, currency, inventory_qty, is_active, created_at',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })

    // Filtre "seulement actifs" par défaut si all !== 1
    if (!all) {
      q = q.eq('is_active', true)
    }

    // Filtre forcé actif/inactif
    if (active === '1') q = q.eq('is_active', true)
    if (active === '0') q = q.eq('is_active', false)

    // Filtre catégorie
    if (category) q = q.eq('category', category)

    // Pagination DB
    q = q.range(start, end)

    const { data, count, error } = await q

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      items: data ?? [],
      total: count ?? 0,
      page,
      pageSize: limit,
    })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    )
  }
}
