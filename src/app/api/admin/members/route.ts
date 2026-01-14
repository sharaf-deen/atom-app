export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/apiAuth'

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const body = await req.json().catch(() => ({} as any))
  const q = typeof body.q === 'string' ? body.q : ''
  const role = typeof body.role === 'string' ? body.role : null
  const limitRaw = Number(body.limit ?? 50)
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.floor(limitRaw))) : 50

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !service) {
    return NextResponse.json(
      { ok: false, error: 'Server env missing' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    )
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

  if (q.trim()) {
    const like = `%${q.trim()}%`
    query = query.or(
      `email.ilike.${like},first_name.ilike.${like},last_name.ilike.${like},phone.ilike.${like}`
    )
  }

  const { data, error } = await query
  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  return NextResponse.json(
    { ok: true, members: data ?? [] },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
