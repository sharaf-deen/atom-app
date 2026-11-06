// src/app/api/subscriptions/delete/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { canManagePayments, normalizeRole } from '@/lib/rbac'

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function makeAdminClient() {
  try {
    return createSupabaseAdminClient()
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    // Auth + admin only
    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) return json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle<{ role: string | null }>()

    if (meErr) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message })

    const role = normalizeRole(me?.role)
    if (!canManagePayments(role)) return json(403, { ok: false, error: 'FORBIDDEN' })

    const admin = makeAdminClient()
    if (!admin) {
      return json(500, {
        ok: false,
        error: 'SERVICE_ROLE_MISSING',
        details: 'A server-side Supabase admin API key and URL must be configured.',
      })
    }

    const body = await req.json().catch(() => ({} as any))
    const id = typeof body?.id === 'string' ? body.id.trim() : ''
    if (!id) return json(400, { ok: false, error: 'MISSING_ID' })

    // Request the deleted row in the same DELETE statement. This avoids a
    // separate privileged lookup and gives the audit its actual target.
    const { data: deleted, error } = await admin
      .from('subscriptions')
      .delete()
      .eq('id', id)
      .select('id, member_id')
      .maybeSingle<{ id: string; member_id: string }>()
    if (error) {
      if (error.code === '23514') {
        return json(409, {
          ok: false,
          error: 'SUBSCRIPTION_HISTORY_PROTECTED',
          details: error.message,
        })
      }
      return json(500, { ok: false, error: 'DELETE_FAILED', details: error.message })
    }
    if (!deleted) return json(404, { ok: false, error: 'SUBSCRIPTION_NOT_FOUND' })

    // Audit the successfully deleted subscription, with a server-side actor.
    // This write is not transactional with DELETE. Surface audit failures so
    // they cannot be mistaken for a confirmed audit trail.
    let audit_logged = false
    try {
      const { error: auditError } = await admin.from('audit_logs').insert({
        actor_user_id: auth.user.id,
        target_user_id: deleted.member_id,
        action: 'subscription_deleted',
        action_details: { subscription_id: deleted.id, source: 'api/subscriptions/delete' },
      })
      audit_logged = !auditError
      if (auditError) console.error('SUBSCRIPTION_DELETE_AUDIT_FAILED', auditError.code ?? 'UNKNOWN')
    } catch {
      console.error('SUBSCRIPTION_DELETE_AUDIT_FAILED', 'UNEXPECTED')
    }

    return json(200, { ok: true, audit_logged })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
