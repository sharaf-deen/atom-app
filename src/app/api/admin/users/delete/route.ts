export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { canDeleteUser, canManageRoles, normalizeRole, type Role } from '@/lib/rbac'

type DeleteOutcome =
  | 'deleted'
  | 'orphan_profile_deleted'
  | 'forbidden'
  | 'self_delete_blocked'
  | 'last_super_admin_blocked'
  | 'not_found'
  | 'invalid_user_id'
  | 'delete_failed'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
}

async function removeIdPhotoIfAny(admin: any, idPhotoPath?: string | null) {
  const path = String(idPhotoPath ?? '').trim()
  if (!path) return
  try {
    await admin.storage.from('id-photos').remove([path])
  } catch {
    // best effort only
  }
}

async function removeInvoiceFilesForUser(admin: any, userId: string) {
  const prefix = String(userId || '').trim()
  if (!prefix) return

  try {
    const { data, error } = await admin.storage.from('invoices').list(prefix, {
      limit: 100,
      offset: 0,
      sortBy: { column: 'name', order: 'asc' },
    })

    if (error || !Array.isArray(data) || data.length === 0) return

    const files = data
      .filter((item: any) => item && typeof item.name === 'string' && item.name)
      .map((item: any) => `${prefix}/${item.name}`)

    if (files.length > 0) {
      await admin.storage.from('invoices').remove(files)
    }
  } catch {
    // best effort only
  }
}

async function removeAttendanceForUser(admin: any, userId: string) {
  const { error } = await admin.from('attendance').delete().eq('member_id', userId)
  if (error) throw new Error(`ATTENDANCE_DELETE_FAILED: ${error.message}`)
}

async function insertAuditLog(admin: any, payload: {
  actor_user_id: string
  target_user_id: string
  action: string
  action_details: Record<string, unknown>
}) {
  try {
    await admin.from('audit_logs').insert(payload)
  } catch {
    // best effort only
  }
}

function looksLikeUserNotFound(message: string) {
  const m = message.toLowerCase()
  return m.includes('user not found') || m.includes('not found')
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any))
    const userId = String(body?.userId ?? '').trim()

    if (!isUuid(userId)) {
      return noStore(
        NextResponse.json(
          {
            ok: false,
            outcome: 'invalid_user_id' as DeleteOutcome,
            error: 'INVALID_USER_ID',
            details: 'Invalid user id.',
          },
          { status: 400 },
        ),
      )
    }

    const supa = createSupabaseServerActionClient()
    const { data: authData, error: authErr } = await supa.auth.getUser()

    if (authErr) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'AUTH_ERROR', details: authErr.message },
          { status: 401 },
        ),
      )
    }

    const actor = authData.user
    if (!actor) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'NOT_AUTHENTICATED', details: 'Not authenticated.' },
          { status: 401 },
        ),
      )
    }

    const { data: actorProfile, error: actorErr } = await supa
      .from('profiles')
      .select('user_id, role')
      .eq('user_id', actor.id)
      .maybeSingle<{ user_id: string; role: Role | null }>()

    if (actorErr) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'ACTOR_PROFILE_ERROR', details: actorErr.message },
          { status: 500 },
        ),
      )
    }

    const actorRole = normalizeRole(actorProfile?.role)
    if (!canManageRoles(actorRole)) {
      return noStore(
        NextResponse.json(
          {
            ok: false,
            outcome: 'forbidden' as DeleteOutcome,
            error: 'FORBIDDEN',
            details: 'Only super admin can permanently delete users.',
          },
          { status: 403 },
        ),
      )
    }

    if (!canDeleteUser(actorRole, { isSelf: userId === actor.id })) {
      return noStore(
        NextResponse.json(
          {
            ok: false,
            outcome: 'self_delete_blocked' as DeleteOutcome,
            error: 'SELF_DELETE_BLOCKED',
            details: 'You cannot delete your own account.',
          },
          { status: 400 },
        ),
      )
    }

    const admin = createSupabaseAdminClient()

    const { data: targetProfile, error: targetErr } = await admin
      .from('profiles')
      .select('user_id, email, role, member_id, id_photo_path')
      .eq('user_id', userId)
      .maybeSingle<{
        user_id: string
        email: string | null
        role: Role | null
        member_id: string | null
        id_photo_path: string | null
      }>()

    if (targetErr) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'TARGET_PROFILE_ERROR', details: targetErr.message },
          { status: 500 },
        ),
      )
    }

    if (!targetProfile) {
      return noStore(
        NextResponse.json(
          {
            ok: false,
            outcome: 'not_found' as DeleteOutcome,
            error: 'NOT_FOUND',
            details: 'User profile not found.',
          },
          { status: 404 },
        ),
      )
    }

    if (targetProfile.role === 'super_admin') {
      const { count, error: countErr } = await admin
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'super_admin')

      if (countErr) {
        return noStore(
          NextResponse.json(
            { ok: false, error: 'SUPER_ADMIN_COUNT_ERROR', details: countErr.message },
            { status: 500 },
          ),
        )
      }

      if ((count ?? 0) <= 1) {
        return noStore(
          NextResponse.json(
            {
              ok: false,
              outcome: 'last_super_admin_blocked' as DeleteOutcome,
              error: 'LAST_SUPER_ADMIN_BLOCKED',
              details: 'Cannot delete the last super admin.',
            },
            { status: 400 },
          ),
        )
      }
    }

    await removeIdPhotoIfAny(admin, targetProfile.id_photo_path)
    await removeInvoiceFilesForUser(admin, userId)

    const authLookup = await admin.auth.admin.getUserById(userId)
    const authLookupError = authLookup.error
    const authUserExists = !authLookupError && !!authLookup.data?.user

    if (authLookupError && !looksLikeUserNotFound(authLookupError.message || '')) {
      return noStore(
        NextResponse.json(
          {
            ok: false,
            outcome: 'delete_failed' as DeleteOutcome,
            error: 'AUTH_LOOKUP_FAILED',
            details: authLookupError.message,
          },
          { status: 400 },
        ),
      )
    }

    await removeAttendanceForUser(admin, userId)

    if (!authUserExists) {
      const { error: deleteProfileError } = await admin
        .from('profiles')
        .delete()
        .eq('user_id', userId)

      if (deleteProfileError) {
        return noStore(
          NextResponse.json(
            {
              ok: false,
              outcome: 'delete_failed' as DeleteOutcome,
              error: 'DELETE_ORPHAN_PROFILE_FAILED',
              details: deleteProfileError.message,
            },
            { status: 400 },
          ),
        )
      }

      await insertAuditLog(admin, {
        actor_user_id: actor.id,
        target_user_id: userId,
        action: 'delete_orphan_profile',
        action_details: {
          email: targetProfile.email,
          role: targetProfile.role,
          member_id: targetProfile.member_id,
          attendance_cleanup: true,
        },
      })

      return noStore(
        NextResponse.json({
          ok: true,
          outcome: 'orphan_profile_deleted' as DeleteOutcome,
          deleted: {
            user_id: targetProfile.user_id,
            email: targetProfile.email,
            role: targetProfile.role,
            member_id: targetProfile.member_id,
          },
        }),
      )
    }

    const { error: delErr } = await admin.auth.admin.deleteUser(userId)

    if (delErr) {
      return noStore(
        NextResponse.json(
          {
            ok: false,
            outcome: 'delete_failed' as DeleteOutcome,
            error: 'DELETE_FAILED',
            details: delErr.message,
          },
          { status: 400 },
        ),
      )
    }

    await insertAuditLog(admin, {
      actor_user_id: actor.id,
      target_user_id: userId,
      action: 'delete_user',
      action_details: {
        email: targetProfile.email,
        role: targetProfile.role,
        member_id: targetProfile.member_id,
        attendance_cleanup: true,
      },
    })

    return noStore(
      NextResponse.json({
        ok: true,
        outcome: 'deleted' as DeleteOutcome,
        deleted: {
          user_id: targetProfile.user_id,
          email: targetProfile.email,
          role: targetProfile.role,
          member_id: targetProfile.member_id,
        },
      }),
    )
  } catch (e: any) {
    console.error('admin/users/delete error:', e)
    return noStore(
      NextResponse.json(
        {
          ok: false,
          error: 'SERVER_ERROR',
          details: e?.message ?? 'Unexpected error',
        },
        { status: 500 },
      ),
    )
  }
}