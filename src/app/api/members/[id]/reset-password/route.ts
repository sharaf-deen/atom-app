export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import type { Role } from '@/lib/session'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createClient } from '@supabase/supabase-js'

const STAFF: Role[] = ['reception', 'admin', 'super_admin']
const can = (r: Role) => STAFF.includes(r)

const ACTION_RESET = 'member_reset_password_send'

const RL_RESET_LIMIT = 10
const RL_RESET_WINDOW_MIN = 10

const RL_RESET_PER_TARGET_LIMIT = 3
const RL_RESET_PER_TARGET_WINDOW_HOURS = 24

const RL_TARGET_COOLDOWN_SECONDS = 60

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function normalizeEmail(raw: any) {
  const e = String(raw ?? '').trim().toLowerCase()
  return e || ''
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
}

function getIp(req: Request) {
  const xf = req.headers.get('x-forwarded-for') || ''
  const ip = xf.split(',')[0]?.trim()
  return ip || req.headers.get('x-real-ip') || null
}

function getUA(req: Request) {
  return req.headers.get('user-agent') || null
}

function getAppUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '')
}

function newRequestId() {
  try {
    return (globalThis.crypto as any)?.randomUUID?.() || `${Date.now()}-${Math.random()}`
  } catch {
    return `${Date.now()}-${Math.random()}`
  }
}

async function safeAudit(admin: any, row: any) {
  try {
    await admin.from('audit_logs').insert(row)
  } catch {
    // audit ne doit jamais casser le flux
  }
}

async function countActions(admin: any, where: Record<string, any>, sinceISO: string) {
  try {
    let q = admin
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sinceISO)

    for (const [k, v] of Object.entries(where)) q = q.eq(k, v)

    const { count, error } = await q
    if (error) return null
    return count ?? 0
  } catch {
    return null
  }
}

function isActiveAuthUser(u: any) {
  const confirmedAt = u?.email_confirmed_at || u?.confirmed_at
  const lastSignInAt = u?.last_sign_in_at
  return !!(confirmedAt || lastSignInAt)
}

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const ip = getIp(req)
  const userAgent = getUA(req)
  const requestId = newRequestId()
  const startedAt = Date.now()

  const memberUserId = String(ctx?.params?.id ?? '').trim()
  if (!isUuid(memberUserId)) {
    return noStore(NextResponse.json({ ok: false, error: 'INVALID_MEMBER_ID' }, { status: 400 }))
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_MISCONFIGURED' }, { status: 500 }))
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  let actorIdForAudit: string | null = null
  let actorEmailForAudit: string | null = null

  try {
    const supa = createSupabaseServerActionClient()
    const { data: authData, error: authErr } = await supa.auth.getUser()
    if (authErr) {
      return noStore(
        NextResponse.json({ ok: false, error: `AUTH_ERROR: ${authErr.message}` }, { status: 401 }),
      )
    }

    const actor = authData.user
    if (!actor) {
      return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))
    }

    actorIdForAudit = actor.id
    actorEmailForAudit = actor.email ?? null

    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', actor.id)
      .maybeSingle()

    if (meErr) {
      return noStore(
        NextResponse.json({ ok: false, error: `ACTOR_PROFILE_ERROR: ${meErr.message}` }, { status: 500 }),
      )
    }

    const role = (me?.role ?? 'member') as Role
    if (!can(role)) {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    {
      const since = new Date(Date.now() - RL_RESET_WINDOW_MIN * 60 * 1000).toISOString()
      const n = await countActions(admin, { actor_user_id: actor.id, action: ACTION_RESET }, since)

      if (n !== null && n >= RL_RESET_LIMIT) {
        await safeAudit(admin, {
          actor_user_id: actor.id,
          target_user_id: memberUserId,
          action: ACTION_RESET,
          action_details: {
            request_id: requestId,
            actor_email: actor.email ?? null,
            ip,
            user_agent: userAgent,
            outcome: 'blocked',
            reason: 'rate_limit_actor',
            details: `${RL_RESET_LIMIT}/${RL_RESET_WINDOW_MIN}min`,
            ms: Date.now() - startedAt,
          },
        })

        const res = NextResponse.json(
          {
            ok: false,
            error: 'RATE_LIMITED',
            details: 'Too many reset attempts. Please try again later.',
          },
          { status: 429 },
        )
        res.headers.set('Retry-After', String(RL_RESET_WINDOW_MIN * 60))
        return noStore(res)
      }
    }

    const { data: prof, error: profErr } = await admin
      .from('profiles')
      .select('user_id, email, first_name, last_name')
      .eq('user_id', memberUserId)
      .maybeSingle()

    if (profErr) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: profErr.message },
          { status: 500 },
        ),
      )
    }
    if (!prof?.user_id) {
      return noStore(NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 }))
    }

    {
      const since = new Date(Date.now() - RL_TARGET_COOLDOWN_SECONDS * 1000).toISOString()
      const n = await countActions(admin, { action: ACTION_RESET, target_user_id: memberUserId }, since)

      if (n !== null && n >= 1) {
        await safeAudit(admin, {
          actor_user_id: actor.id,
          target_user_id: memberUserId,
          action: ACTION_RESET,
          action_details: {
            request_id: requestId,
            actor_email: actor.email ?? null,
            target_email: normalizeEmail(prof.email),
            ip,
            user_agent: userAgent,
            outcome: 'blocked',
            reason: 'cooldown_target',
            details: `${RL_TARGET_COOLDOWN_SECONDS}s`,
            ms: Date.now() - startedAt,
          },
        })

        const res = NextResponse.json(
          {
            ok: false,
            error: 'RATE_LIMITED',
            details: 'Please wait a moment before sending another reset email.',
          },
          { status: 429 },
        )
        res.headers.set('Retry-After', String(RL_TARGET_COOLDOWN_SECONDS))
        return noStore(res)
      }
    }

    {
      const since = new Date(Date.now() - RL_RESET_PER_TARGET_WINDOW_HOURS * 60 * 60 * 1000).toISOString()
      const n = await countActions(admin, { action: ACTION_RESET, target_user_id: memberUserId }, since)

      if (n !== null && n >= RL_RESET_PER_TARGET_LIMIT) {
        await safeAudit(admin, {
          actor_user_id: actor.id,
          target_user_id: memberUserId,
          action: ACTION_RESET,
          action_details: {
            request_id: requestId,
            actor_email: actor.email ?? null,
            target_email: normalizeEmail(prof.email),
            ip,
            user_agent: userAgent,
            outcome: 'blocked',
            reason: 'rate_limit_target',
            details: `${RL_RESET_PER_TARGET_LIMIT}/${RL_RESET_PER_TARGET_WINDOW_HOURS}h`,
            ms: Date.now() - startedAt,
          },
        })

        const res = NextResponse.json(
          {
            ok: false,
            error: 'RATE_LIMITED',
            details: 'Too many reset emails for this member. Try later.',
          },
          { status: 429 },
        )
        res.headers.set('Retry-After', String(RL_RESET_PER_TARGET_WINDOW_HOURS * 60 * 60))
        return noStore(res)
      }
    }

    let authUser: any = null
    let authMissing = false
    let authErr2: any = null

    try {
      const r = await (admin.auth.admin as any).getUserById(memberUserId)
      authUser = r?.data?.user ?? null
      authErr2 = r?.error ?? null
      if (!authUser) authMissing = true
    } catch (e: any) {
      authErr2 = e
      authMissing = true
    }

    if (authMissing) {
      await safeAudit(admin, {
        actor_user_id: actor.id,
        target_user_id: memberUserId,
        action: ACTION_RESET,
        action_details: {
          request_id: requestId,
          actor_email: actor.email ?? null,
          target_email: normalizeEmail(prof.email),
          ip,
          user_agent: userAgent,
          outcome: 'rejected',
          reason: 'orphan_profile_no_auth_user',
          details: authErr2?.message ?? String(authErr2 ?? 'auth user not found'),
          ms: Date.now() - startedAt,
        },
      })

      return noStore(
        NextResponse.json(
          {
            ok: false,
            error: 'ORPHAN_PROFILE',
            details:
              'This profile does not have a matching auth user. Re-create the member (or fix auth/users) before sending reset emails.',
          },
          { status: 409 },
        ),
      )
    }

    if (!isActiveAuthUser(authUser)) {
      await safeAudit(admin, {
        actor_user_id: actor.id,
        target_user_id: memberUserId,
        action: ACTION_RESET,
        action_details: {
          request_id: requestId,
          actor_email: actor.email ?? null,
          target_email: normalizeEmail(authUser?.email || prof.email),
          ip,
          user_agent: userAgent,
          outcome: 'rejected',
          reason: 'invite_pending',
          details: 'Account not active yet',
          ms: Date.now() - startedAt,
        },
      })

      return noStore(
        NextResponse.json(
          {
            ok: false,
            error: 'INVITE_PENDING',
            details: 'This member has not activated the account yet. Use Resend invite instead.',
          },
          { status: 409 },
        ),
      )
    }

    const targetEmail = normalizeEmail(authUser?.email || prof.email)
    if (!targetEmail) {
      return noStore(NextResponse.json({ ok: false, error: 'MEMBER_HAS_NO_EMAIL' }, { status: 400 }))
    }

    const redirectTo = `${getAppUrl()}/reset`

    const { error: resetErr } = await admin.auth.resetPasswordForEmail(targetEmail, {
      redirectTo,
    })

    if (resetErr) {
      await safeAudit(admin, {
        actor_user_id: actor.id,
        target_user_id: memberUserId,
        action: ACTION_RESET,
        action_details: {
          request_id: requestId,
          actor_email: actor.email ?? null,
          target_email: targetEmail,
          ip,
          user_agent: userAgent,
          outcome: 'failed',
          reason: 'reset_failed',
          details: resetErr.message,
          ms: Date.now() - startedAt,
        },
      })

      return noStore(
        NextResponse.json(
          { ok: false, error: 'RESET_FAILED', details: resetErr.message },
          { status: 500 },
        ),
      )
    }

    await safeAudit(admin, {
      actor_user_id: actor.id,
      target_user_id: memberUserId,
      action: ACTION_RESET,
      action_details: {
        request_id: requestId,
        actor_email: actor.email ?? null,
        target_email: targetEmail,
        ip,
        user_agent: userAgent,
        outcome: 'ok',
        details: 'Password reset email sent',
        ms: Date.now() - startedAt,
      },
    })

    return noStore(
      NextResponse.json({
        ok: true,
        outcome: 'reset_sent',
        user_id: memberUserId,
        email: targetEmail,
        retry_after_seconds: RL_TARGET_COOLDOWN_SECONDS,
        message: 'Password reset email sent.',
      }),
    )
  } catch (e: any) {
    console.error('members/[id]/reset-password error:', e)

    await safeAudit(admin, {
      actor_user_id: actorIdForAudit,
      target_user_id: memberUserId,
      action: ACTION_RESET,
      action_details: {
        request_id: requestId,
        actor_email: actorEmailForAudit,
        ip,
        user_agent: userAgent,
        outcome: 'failed',
        reason: 'server_error',
        details: e?.message || String(e),
        ms: Date.now() - startedAt,
      },
    })

    return noStore(
      NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) }, { status: 500 }),
    )
  }
}
