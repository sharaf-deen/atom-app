// src/app/api/admin/find-member/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/apiAuth'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase().slice(0, 320) : ''
}

/**
 * POST /api/admin/find-member
 * Body: { email: string }
 * Returns the profile and the latest subscription.
 * Uses SERVICE_ROLE to bypass RLS on protected admin lookup.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (!gate.ok) return noStore(gate.res)

  try {
    const body = await req.json().catch(() => ({} as any))
    const email = normalizeEmail(body?.email)

    if (!email || !email.includes('@')) {
      return noStore(NextResponse.json({ ok: false, error: 'Missing email' }, { status: 400 }))
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !service) {
      return noStore(NextResponse.json({ ok: false, error: 'Server env missing' }, { status: 500 }))
    }

    const admin = createClient(url, service, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: profile, error: pErr } = await admin
      .from('profiles')
      .select('user_id,email,first_name,last_name,phone,role,member_id')
      .eq('email', email)
      .maybeSingle()

    if (pErr) return noStore(NextResponse.json({ ok: false, error: pErr.message }, { status: 400 }))
    if (!profile) return noStore(NextResponse.json({ ok: false, error: 'Member not found' }, { status: 404 }))

    const { data: subs, error: sErr } = await admin
      .from('subscriptions')
      .select('id,member_id,plan,subscription_type,status,start_date,end_date,amount,paid_at,sessions_total,sessions_used,payment_method,amount_due,created_at,frozen_from,frozen_until,is_staff')
      .eq('member_id', profile.user_id)
      .order('start_date', { ascending: false })
      .limit(1)

    if (sErr) return noStore(NextResponse.json({ ok: false, error: sErr.message }, { status: 400 }))

    const last_subscription = subs?.[0] ?? null

    return noStore(NextResponse.json({ ok: true, profile, last_subscription }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: e?.message ?? 'Server error' }, { status: 500 }))
  }
}

/**
 * GET /api/admin/find-member
 * Small hint endpoint, protected like POST to avoid leaking admin route shape.
 */
export async function GET() {
  const gate = await requireAdmin()
  if (!gate.ok) return noStore(gate.res)
  return noStore(NextResponse.json({ ok: true, hint: 'POST { email }' }))
}
