// src/app/api/notifications/mark-read/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'


function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

type Body = { ids: string[] }

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()
    const { data: auth } = await supa.auth.getUser()
    const user = auth.user
    if (!user) return noStore(NextResponse.json({ ok:false, error:'NOT_AUTHENTICATED' }, { status:401 }))

    const b = (await req.json()) as Body
    const ids = Array.isArray(b?.ids) ? b.ids.filter(Boolean) : []
    if (ids.length === 0) {
      return noStore(NextResponse.json({ ok:false, error:'NO_IDS' }, { status:400 }))
    }

    // RLS: policy UPDATE doit autoriser si user_id = auth.uid()
    const { error } = await supa
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .in('id', ids)

    if (error) {
      return noStore(NextResponse.json({ ok:false, error:'UPDATE_FAILED', details: error.message }, { status:500 }))
    }
    return noStore(NextResponse.json({ ok:true, count: ids.length }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok:false, error: e?.message || 'SERVER_ERROR' }, { status:500 }))
  }
}
