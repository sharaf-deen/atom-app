// src/app/api/store/products/create/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'


type Category = 'kimono' | 'rashguard' | 'short' | 'belt'
type Body = {
  category: Category
  name: string
  color?: string
  size?: string
  price_cents: number
  inventory_qty?: number
  is_active?: boolean
  currency?: string | null
}

function noStore(res: NextResponse) { res.headers.set('Cache-Control','no-store'); return res }

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()
    const { data: auth } = await supa.auth.getUser()
    if (!auth.user) return noStore(NextResponse.json({ ok:false, error:'NOT_AUTHENTICATED' }, { status:401 }))

    // ✅ SEUL super_admin peut créer
    const { data: me } = await supa.from('profiles').select('role').eq('user_id', auth.user.id).maybeSingle()
    if (!me || me.role !== 'super_admin') {
      return noStore(NextResponse.json({ ok:false, error:'FORBIDDEN' }, { status:403 }))
    }

    const b = await req.json() as Body
    const payload = {
      category: b.category,
      name: (b.name || '').trim(),
      color: (b.color || '').trim() || null,
      size: (b.size || '').trim() || null,
      price_cents: Math.max(0, Number(b.price_cents || 0)),
      inventory_qty: Math.max(0, Number(b.inventory_qty ?? 0)),
      is_active: b.is_active ?? true,
      currency: b.currency ?? 'EGP',
      created_by: auth.user.id,
    }
    if (!payload.name) return noStore(NextResponse.json({ ok:false, error:'INVALID_INPUT' }, { status:400 }))

    const { data, error } = await supa.from('store_products').insert(payload).select('id').maybeSingle()
    if (error) return noStore(NextResponse.json({ ok:false, error:error.message }, { status:500 }))

    return noStore(NextResponse.json({ ok:true, id: data?.id }))
  } catch (e:any) {
    return noStore(NextResponse.json({ ok:false, error:e?.message || 'SERVER_ERROR' }, { status:500 }))
  }
}
