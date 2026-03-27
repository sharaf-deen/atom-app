export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireUser } from '@/lib/apiAuth'
import { canAccessMembersList, isRole } from '@/lib/rbac'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function sanitizeSearch(value: unknown) {
  return typeof value === 'string'
    ? value.replace(/[%,_]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
    : ''
}

export async function POST(req: NextRequest) {
  const gate = await requireUser()
  if (!gate.ok) return noStore(gate.res)

  if (!canAccessMembersList(gate.user.role)) {
    return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
  }

  const body = await req.json().catch(() => ({} as any))
  const q = sanitizeSearch(body.q)
  const roleRaw = typeof body.role === 'string' ? body.role.trim() : ''
  const role = isRole(roleRaw) ? roleRaw : null

  const limitRaw = Number(body.limit ?? 50)
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.floor(limitRaw))) : 50

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !service) {
    return noStore(NextResponse.json({ ok: false, error: 'Server env missing' }, { status: 500 }))
  }

  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let query = admin
    .from('profiles')
    .select('user_id,email,first_name,last_name,phone,role')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (role) query = query.eq('role', role)

  if (q) {
    const like = `%${q}%`
    query = query.or(
      `email.ilike.${like},first_name.ilike.${like},last_name.ilike.${like},phone.ilike.${like},member_id.ilike.${like}`
    )
  }

  const { data, error } = await query
  if (error) {
    return noStore(NextResponse.json({ ok: false, error: error.message }, { status: 400 }))
  }

  return noStore(NextResponse.json({ ok: true, members: data ?? [] }))
}
