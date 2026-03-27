// src/app/api/admin/find-member/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/apiAuth'
import { jsonWithApiRuntime, logApiError, startApiRuntime } from '@/lib/apiRuntime'

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
  const meta = startApiRuntime('/api/admin/find-member')
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  try {
    const body = await req.json().catch(() => ({} as any))
    const email = normalizeEmail(body?.email)

    if (!email || !email.includes('@')) {
      return jsonWithApiRuntime(meta, 400, { ok: false, error: 'Missing email' })
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !service) {
      logApiError(meta, 'env', 'SUPABASE env missing')
      return jsonWithApiRuntime(meta, 500, { ok: false, error: 'Server env missing' })
    }

    const admin = createClient(url, service, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: profile, error: pErr } = await admin
      .from('profiles')
      .select('user_id,email,first_name,last_name,phone,role,member_id')
      .eq('email', email)
      .maybeSingle()

    if (pErr) {
      logApiError(meta, 'profile_lookup', pErr, { email })
      return jsonWithApiRuntime(meta, 400, { ok: false, error: pErr.message })
    }
    if (!profile) return jsonWithApiRuntime(meta, 404, { ok: false, error: 'Member not found' })

    const { data: subs, error: sErr } = await admin
      .from('subscriptions')
      .select('id,member_id,plan,subscription_type,status,start_date,end_date,amount,paid_at,sessions_total,sessions_used,payment_method,amount_due,created_at,frozen_from,frozen_until,is_staff')
      .eq('member_id', profile.user_id)
      .order('start_date', { ascending: false })
      .limit(1)

    if (sErr) {
      logApiError(meta, 'subscription_lookup', sErr, { member_id: profile.user_id })
      return jsonWithApiRuntime(meta, 400, { ok: false, error: sErr.message })
    }

    const last_subscription = subs?.[0] ?? null

    return jsonWithApiRuntime(meta, 200, { ok: true, profile, last_subscription })
  } catch (e: any) {
    logApiError(meta, 'unexpected', e)
    return jsonWithApiRuntime(meta, 500, { ok: false, error: e?.message ?? 'Server error' })
  }
}

/**
 * GET /api/admin/find-member
 * Small hint endpoint, protected like POST to avoid leaking admin route shape.
 */
export async function GET() {
  const meta = startApiRuntime('/api/admin/find-member')
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  return jsonWithApiRuntime(meta, 200, { ok: true, hint: 'POST { email }' })
}
