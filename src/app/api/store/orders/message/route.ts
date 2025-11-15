// src/app/api/store/orders/message/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'


type Body = { order_id: string; body: string }

function noStore(res: NextResponse) { res.headers.set('Cache-Control','no-store'); return res }

export async function POST(req: Request) {
  const supa = createSupabaseServerActionClient()
  const { data: auth } = await supa.auth.getUser()
  if (!auth.user) return noStore(NextResponse.json({ ok:false, error:'NOT_AUTHENTICATED' }, { status:401 }))

  const { data: me } = await supa.from('profiles').select('role').eq('user_id', auth.user.id).maybeSingle()
  if (!me || !['admin','super_admin'].includes(me.role ?? 'member')) {
    return noStore(NextResponse.json({ ok:false, error:'FORBIDDEN' }, { status:403 }))
  }

  const b = await req.json() as Body
  const text = (b.body || '').trim()
  if (!b.order_id || !text) return noStore(NextResponse.json({ ok:false, error:'INVALID_INPUT' }, { status:400 }))

  const { error } = await supa
    .from('store_order_messages')
    .insert({ order_id: b.order_id, sender_id: auth.user.id, body: text })

  if (error) return noStore(NextResponse.json({ ok:false, error:'INSERT_FAILED', details: error.message }, { status:500 }))

  return noStore(NextResponse.json({ ok:true }))
}
