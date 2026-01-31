// src/app/api/admin/audit/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/apiAuth'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

/**
 * GET /api/admin/audit
 * Retourne les 20 dernières actions de l’audit log.
 * IMPORTANT: cet endpoint utilise la SERVICE_ROLE => il doit être protégé (admin/super_admin).
 */
export async function GET() {
  const gate = await requireAdmin()
  if (!gate.ok) return noStore(gate.res)

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !service) {
      return noStore(NextResponse.json({ ok: false, error: 'Server env missing' }, { status: 500 }))
    }

    const admin = createClient(url, service, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data, error } = await admin
      .from('audit_logs')
      .select('id, created_at, actor_user_id, target_user_id, action, action_details')
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      return noStore(NextResponse.json({ ok: false, error: error.message }, { status: 400 }))
    }

    return noStore(NextResponse.json({ ok: true, logs: data ?? [] }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: e?.message ?? 'Server error' }, { status: 500 }))
  }
}
