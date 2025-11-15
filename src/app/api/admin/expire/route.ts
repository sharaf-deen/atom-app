// src/app/api/admin/expire/route.ts
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'


function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

async function handle() {
  const supa = createSupabaseServerActionClient()

  // Auth
  const { data: auth } = await supa.auth.getUser()
  if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

  // Only admin / super_admin
  const { data: me, error: meErr } = await supa
    .from('profiles')
    .select('role')
    .eq('user_id', auth.user.id)
    .maybeSingle<{ role: string | null }>()
  if (meErr) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message })

  const role = me?.role ?? 'member'
  if (!['admin', 'super_admin'].includes(role)) {
    return json(403, { ok: false, error: 'FORBIDDEN' })
  }

  // Run the expiration function
  const { data, error } = await supa.rpc('expire_subscriptions')
  if (error) return json(500, { ok: false, error: 'RPC_FAILED', details: error.message })

  return json(200, data ?? { ok: true })
}

export async function POST() { return handle() }
export async function GET()  { return handle() }
