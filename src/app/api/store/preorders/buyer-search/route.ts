export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(req: Request) {
  const me = await getSessionUser()
  if (!me) return reply({ ok: false, error: 'NOT_AUTHENTICATED' }, 401)
  if (me.role !== 'super_admin') return reply({ ok: false, error: 'FORBIDDEN' }, 403)

  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') ?? '').trim().slice(0, 100)
  if (q.length < 2) return reply({ ok: true, items: [] })
  const rawLimit = Number(searchParams.get('limit') ?? 8)
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(Math.floor(rawLimit), 20)) : 8
  const qDigits = q.replace(/\D/g, '')
  const safeQ = q.replace(/[,().%*]/g, ' ').replace(/\s+/g, ' ').trim()
  if (safeQ.length < 2) return reply({ ok: true, items: [] })

  try {
    const filters = [
      'first_name.ilike.%' + safeQ + '%',
      'last_name.ilike.%' + safeQ + '%',
      'email.ilike.%' + safeQ + '%',
      'member_id.ilike.%' + safeQ + '%',
      'phone.ilike.%' + safeQ + '%',
    ]
    if (qDigits.length >= 4) filters.push('phone_digits.ilike.%' + qDigits + '%')
    const { data, error } = await createSupabaseAdminClient()
      .from('profiles')
      .select('user_id,member_id,email,first_name,last_name,phone,role')
      .or(filters.join(','))
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return reply({ ok: false, error: 'BUYER_SEARCH_FAILED' }, 500)
    return reply({ ok: true, items: data ?? [] })
  } catch {
    return reply({ ok: false, error: 'BUYER_SEARCH_FAILED' }, 500)
  }
}
