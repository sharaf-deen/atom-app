// src/app/api/staff/list/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

import { createClient } from '@supabase/supabase-js'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

type StaffRow = {
  user_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  role: 'assistant_coach' | 'coach'
}

export async function GET(req: Request) {
  try {
    // 1) Vérifie que l'appelant est admin/super_admin (via session)
    const supa = createSupabaseServerActionClient()
    const { data: auth } = await supa.auth.getUser()
    if (!auth.user) return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))

    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle<{ role: string | null }>()
    if (meErr) return noStore(NextResponse.json({ ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message }, { status: 500 }))
    const role = me?.role ?? 'member'
    if (!['admin', 'super_admin'].includes(role)) {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    // 2) Utilise le service role pour lister le staff (pas de friction RLS)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY!
    if (!url || !service) {
      return noStore(NextResponse.json({ ok: false, error: 'SERVER_ENV_MISSING' }, { status: 500 }))
    }
    const admin = createClient(url, service)

    const { searchParams } = new URL(req.url)
    const q = (searchParams.get('q') || '').trim()
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 100), 1), 1000)

    let query = admin
      .from('profiles')
      .select('user_id, email, first_name, last_name, role')
      .in('role', ['assistant_coach', 'coach'])
      .order('role', { ascending: true })
      .order('first_name', { ascending: true })
      .limit(limit)

    if (q) {
      query = query.or(
        `first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`
      )
    }

    const { data, error } = await query as { data: StaffRow[] | null; error: any }
    if (error) return noStore(NextResponse.json({ ok: false, error: 'QUERY_FAILED', details: error.message }, { status: 500 }))

    return noStore(NextResponse.json({ ok: true, items: data ?? [] }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: e?.message || 'SERVER_ERROR' }, { status: 500 }))
  }
}
