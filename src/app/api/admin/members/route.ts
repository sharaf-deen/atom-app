export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { requireUser } from '@/lib/apiAuth'
import { jsonWithApiRuntime, logApiError, startApiRuntime } from '@/lib/apiRuntime'
import { canAccessMembersList, isRole } from '@/lib/rbac'

function sanitizeSearch(value: unknown) {
  return typeof value === 'string'
    ? value.replace(/[%,_]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
    : ''
}

export async function POST(req: NextRequest) {
  const meta = startApiRuntime('/api/admin/members')
  const gate = await requireUser()
  if (!gate.ok) return gate.res

  if (!canAccessMembersList(gate.user.role)) {
    return jsonWithApiRuntime(meta, 403, { ok: false, error: 'FORBIDDEN' })
  }

  const body = await req.json().catch(() => ({} as any))
  const q = sanitizeSearch(body.q)
  const roleRaw = typeof body.role === 'string' ? body.role.trim() : ''
  const role = isRole(roleRaw) ? roleRaw : null

  const limitRaw = Number(body.limit ?? 50)
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.floor(limitRaw))) : 50

  let admin: ReturnType<typeof createSupabaseAdminClient>
  try {
    admin = createSupabaseAdminClient()
  } catch {
    logApiError(meta, 'env', 'Supabase admin client unavailable')
    return jsonWithApiRuntime(meta, 500, { ok: false, error: 'Server env missing' })
  }

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

  try {
    const { data, error } = await query
    if (error) {
      logApiError(meta, 'query', error, { role, q, limit })
      return jsonWithApiRuntime(meta, 400, { ok: false, error: error.message })
    }

    return jsonWithApiRuntime(meta, 200, { ok: true, members: data ?? [] })
  } catch (error) {
    logApiError(meta, 'unexpected', error, { role, q, limit })
    return jsonWithApiRuntime(meta, 500, { ok: false, error: 'Server error' })
  }
}
