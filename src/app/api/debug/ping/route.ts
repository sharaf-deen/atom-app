// src/app/api/debug/ping/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anon) {
      return noStore(NextResponse.json({ ok: false, error: 'ENV_MISSING', url, hasAnon: !!anon }, { status: 500 }))
    }
    const supa = createClient(url, anon)

    // Ping léger: lecture d’un petit select
    const t0 = Date.now()
    const { data, error } = await supa.from('profiles').select('user_id').limit(1)
    const ms = Date.now() - t0

    if (error) {
      return noStore(NextResponse.json({ ok: false, ms, error: error.message }, { status: 500 }))
    }
    return noStore(NextResponse.json({ ok: true, ms, sample: data }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 }))
  }
}
