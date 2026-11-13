export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { revalidatePath, revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { normalizeRole } from '@/lib/rbac'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MEMBER_ID = /^ATOM-\d{6,}$/

export async function POST(req: Request) {
  const session = createSupabaseServerActionClient()
  const { data: { user }, error: authError } = await session.auth.getUser()
  if (authError || !user) return NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 })

  // Strictly Super Admin; normal family-management permissions are broader.
  const { data: actor, error: actorError } = await session.from('profiles').select('role,archived_at').eq('user_id', user.id).maybeSingle()
  if (actorError || normalizeRole(actor?.role) !== 'super_admin' || actor?.archived_at) {
    return NextResponse.json({ ok: false, error: 'SUPER_ADMIN_REQUIRED' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const familyId = String(body?.familyId ?? '')
  const guardianAuthUserId = String(body?.guardianAuthUserId ?? '')
  const memberIds = body?.memberIds
  const execute = body?.action === 'execute'
  const reason = String(body?.reason ?? '').trim()
  if (!UUID.test(familyId) || !UUID.test(guardianAuthUserId)
      || !Array.isArray(memberIds) || memberIds.length !== 2
      || !memberIds.every((id: unknown) => typeof id === 'string' && MEMBER_ID.test(id))
      || memberIds[0] === memberIds[1] || (body?.action !== 'preview' && !execute)
      || (execute && (reason.length < 10 || reason.length > 1000 || body?.confirmed !== true))) {
    return NextResponse.json({ ok: false, error: 'INVALID_RECOVERY_INPUT' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = execute
    ? await admin.rpc('family_duplicate_recovery_execute', {
        p_family_id: familyId,
        p_guardian_auth_user_id: guardianAuthUserId,
        p_member_ids: memberIds,
        p_actor_id: user.id,
        p_reason: reason,
      })
    : await admin.rpc('family_duplicate_recovery_preview', {
        p_family_id: familyId,
        p_guardian_auth_user_id: guardianAuthUserId,
        p_member_ids: memberIds,
      })
  if (error) {
    // No database details exposed to the browser; review technical diagnostics server-side.
    console.error('[family-duplicate-recovery]', error.code, error.message)
    return NextResponse.json({ ok: false, error: 'RECOVERY_FAILED_OR_BLOCKED' }, { status: 409 })
  }

  if (execute) {
    revalidatePath('/admin/members/families')
    revalidatePath('/admin/members/family-operations')
    revalidateTag('members')
  }
  return NextResponse.json({ ok: true, ...(execute ? { result: data } : { preview: data }) }, { headers: { 'Cache-Control': 'no-store' } })
}
