import { NextResponse } from 'next/server'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'

async function insertAuditLog(admin: ReturnType<typeof getSupabaseAdminClientCached>, payload: {
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

export async function POST(req: Request) {
  try {
    const me = await getSessionUserCached()
    if (!me || me.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }

    if (userId === me.id) {
      return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 })
    }

    const admin = getSupabaseAdminClientCached()

    const { data: targetProfile, error: profileError } = await admin
      .from('profiles')
      .select('user_id, email, role, member_id')
      .eq('user_id', userId)
      .maybeSingle()

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 400 })
    }

    if (!targetProfile) {
      return NextResponse.json({ error: 'User profile not found.' }, { status: 404 })
    }

    if (targetProfile.role === 'super_admin') {
      const { count, error: countError } = await admin
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'super_admin')

      if (countError) {
        return NextResponse.json({ error: countError.message }, { status: 400 })
      }

      if ((count ?? 0) <= 1) {
        return NextResponse.json({ error: 'Cannot delete the last super admin.' }, { status: 400 })
      }
    }

    const authLookup = await admin.auth.admin.getUserById(userId)
    const authUserExists = !authLookup.error && !!authLookup.data?.user

    if (!authUserExists) {
      const { error: deleteProfileError } = await admin
        .from('profiles')
        .delete()
        .eq('user_id', userId)

      if (deleteProfileError) {
        return NextResponse.json({ error: deleteProfileError.message }, { status: 400 })
      }

      await insertAuditLog(admin, {
        actor_user_id: me.id,
        target_user_id: userId,
        action: 'delete_orphan_profile',
        action_details: {
          email: targetProfile.email,
          role: targetProfile.role,
          member_id: targetProfile.member_id,
        },
      })

      return NextResponse.json({
        ok: true,
        deleted: 'orphan_profile',
        userId,
        email: targetProfile.email,
      })
    }

    const { error: deleteAuthError } = await admin.auth.admin.deleteUser(userId)

    if (deleteAuthError) {
      return NextResponse.json({ error: deleteAuthError.message }, { status: 400 })
    }

    await insertAuditLog(admin, {
      actor_user_id: me.id,
      target_user_id: userId,
      action: 'delete_user',
      action_details: {
        email: targetProfile.email,
        role: targetProfile.role,
        member_id: targetProfile.member_id,
      },
    })

    return NextResponse.json({
      ok: true,
      deleted: 'auth_user',
      userId,
      email: targetProfile.email,
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Unexpected delete error' },
      { status: 500 }
    )
  }
}