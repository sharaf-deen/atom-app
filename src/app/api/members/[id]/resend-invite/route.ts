export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import type { Role } from '@/lib/session'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createClient } from '@supabase/supabase-js'
import { extractActionLink, sendMemberInviteEmailWithQr } from '@/lib/memberInviteEmail'

const STAFF: Role[] = ['reception', 'admin', 'super_admin']
const can = (r: Role) => STAFF.includes(r)

// Audit action name (stable)
const ACTION_RESEND = 'member_invite_resend'

// Rate limit (par acteur)
const RL_RESEND_LIMIT = 10
const RL_RESEND_WINDOW_MIN = 10

// Anti-spam (par membre ciblé, tous acteurs confondus)
const RL_RESEND_PER_TARGET_LIMIT = 3
const RL_RESEND_PER_TARGET_WINDOW_HOURS = 24

// Cooldown anti double-click (par cible)
const RL_TARGET_COOLDOWN_SECONDS = 60

type ResendOutcome =
  | 'invite_resent'
  | 'already_active'
  | 'orphan_profile'
  | 'rate_limited_actor'
  | 'rate_limited_target'
  | 'cooldown_target'
  | 'not_found'
  | 'forbidden'
  | 'member_has_no_email'
  | 'invalid_member_id'
  | 'invite_failed'
  | 'server_misconfigured'

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
    // Node 18+ has global crypto
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

// Helper: classify auth user state
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
    return noStore(
      NextResponse.json(
        {
          ok: false,
          outcome: 'invalid_member_id' as ResendOutcome,
          error: 'INVALID_MEMBER_ID',
          details: 'Invalid member id.',
        },
        { status: 400 },
      ),
    )
  }

  // Service role (create once, reused even for error audit)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return noStore(
      NextResponse.json(
        {
          ok: false,
          outcome: 'server_misconfigured' as ResendOutcome,
          error: 'SERVER_MISCONFIGURED',
          details: 'Server misconfigured.',
        },
        { status: 500 },
      ),
    )
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  let actorIdForAudit: string | null = null
  let actorEmailForAudit: string | null = null

  try {
    // 1) Auth acteur (staff uniquement)
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
      return noStore(
        NextResponse.json(
          {
            ok: false,
            outcome: 'forbidden' as ResendOutcome,
            error: 'FORBIDDEN',
            details: 'You do not have permission to resend invites.',
          },
          { status: 403 },
        ),
      )
    }

    // 2) Rate limit (par acteur)
    {
      const since = new Date(Date.now() - RL_RESEND_WINDOW_MIN * 60 * 1000).toISOString()
      const n = await countActions(admin, { actor_user_id: actor.id, action: ACTION_RESEND }, since)

      if (n !== null && n >= RL_RESEND_LIMIT) {
        await safeAudit(admin, {
          actor_user_id: actor.id,
          target_user_id: memberUserId,
          action: ACTION_RESEND,
          action_details: {
            request_id: requestId,
            actor_email: actor.email ?? null,
            ip,
            user_agent: userAgent,
            outcome: 'blocked',
            reason: 'rate_limit_actor',
            details: `${RL_RESEND_LIMIT}/${RL_RESEND_WINDOW_MIN}min`,
            ms: Date.now() - startedAt,
          },
        })

        const res = NextResponse.json(
          {
            ok: false,
            outcome: 'rate_limited_actor' as ResendOutcome,
            error: 'RATE_LIMITED',
            details: 'Too many resend attempts. Please try again later.',
            retry_after_seconds: RL_RESEND_WINDOW_MIN * 60,
          },
          { status: 429 },
        )
        res.headers.set('Retry-After', String(RL_RESEND_WINDOW_MIN * 60))
        return noStore(res)
      }
    }

    // 3) Profil cible
    const { data: prof, error: profErr } = await admin
      .from('profiles')
      .select('user_id, email, first_name, last_name, phone, role, member_id, qr_code')
      .eq('user_id', memberUserId)
      .maybeSingle()

    if (profErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'PROFILE_LOOKUP_FAILED', details: profErr.message }, { status: 500 }),
      )
    }
    if (!prof?.user_id) {
      return noStore(
        NextResponse.json(
          {
            ok: false,
            outcome: 'not_found' as ResendOutcome,
            error: 'NOT_FOUND',
            details: 'This member no longer exists.',
          },
          { status: 404 },
        ),
      )
    }

    const targetEmail = normalizeEmail(prof.email)
    if (!targetEmail) {
      return noStore(
        NextResponse.json(
          {
            ok: false,
            outcome: 'member_has_no_email' as ResendOutcome,
            error: 'MEMBER_HAS_NO_EMAIL',
            details: 'This member has no email address.',
          },
          { status: 400 },
        ),
      )
    }

    // 4) Cooldown par cible (anti double click)
    {
      const since = new Date(Date.now() - RL_TARGET_COOLDOWN_SECONDS * 1000).toISOString()
      const n = await countActions(admin, { action: ACTION_RESEND, target_user_id: memberUserId }, since)

      if (n !== null && n >= 1) {
        await safeAudit(admin, {
          actor_user_id: actor.id,
          target_user_id: memberUserId,
          action: ACTION_RESEND,
          action_details: {
            request_id: requestId,
            actor_email: actor.email ?? null,
            target_email: targetEmail,
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
            outcome: 'cooldown_target' as ResendOutcome,
            error: 'RATE_LIMITED',
            details: 'Please wait a moment before resending again.',
            retry_after_seconds: RL_TARGET_COOLDOWN_SECONDS,
          },
          { status: 429 },
        )
        res.headers.set('Retry-After', String(RL_TARGET_COOLDOWN_SECONDS))
        return noStore(res)
      }
    }

    // 5) Anti-spam par cible (3 / 24h) TOUS acteurs confondus ✅
    {
      const since = new Date(Date.now() - RL_RESEND_PER_TARGET_WINDOW_HOURS * 60 * 60 * 1000).toISOString()
      const n = await countActions(admin, { action: ACTION_RESEND, target_user_id: memberUserId }, since)

      if (n !== null && n >= RL_RESEND_PER_TARGET_LIMIT) {
        await safeAudit(admin, {
          actor_user_id: actor.id,
          target_user_id: memberUserId,
          action: ACTION_RESEND,
          action_details: {
            request_id: requestId,
            actor_email: actor.email ?? null,
            target_email: targetEmail,
            ip,
            user_agent: userAgent,
            outcome: 'blocked',
            reason: 'rate_limit_target',
            details: `${RL_RESEND_PER_TARGET_LIMIT}/${RL_RESEND_PER_TARGET_WINDOW_HOURS}h`,
            ms: Date.now() - startedAt,
          },
        })

        const res = NextResponse.json(
          {
            ok: false,
            outcome: 'rate_limited_target' as ResendOutcome,
            error: 'RATE_LIMITED',
            details: 'Too many resends for this member. Try later.',
            retry_after_seconds: RL_RESEND_PER_TARGET_WINDOW_HOURS * 60 * 60,
          },
          { status: 429 },
        )
        res.headers.set('Retry-After', String(RL_RESEND_PER_TARGET_WINDOW_HOURS * 60 * 60))
        return noStore(res)
      }
    }

    // 6) Vérifie que l’auth user existe (orphan protection) + statut actif
    // IMPORTANT: if profile has no matching auth user by ID, do NOT call inviteUserByEmail
    // because it may create a new auth user with another id → mismatch.
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
        action: ACTION_RESEND,
        action_details: {
          request_id: requestId,
          actor_email: actor.email ?? null,
          target_email: targetEmail,
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
            outcome: 'orphan_profile' as ResendOutcome,
            error: 'ORPHAN_PROFILE',
            next_action: 'recreate_member',
            details:
              'This profile does not have a matching auth user. Re-create the member (or fix auth/users) before resending invites.',
          },
          { status: 409 },
        ),
      )
    }

    if (isActiveAuthUser(authUser)) {
      await safeAudit(admin, {
        actor_user_id: actor.id,
        target_user_id: memberUserId,
        action: ACTION_RESEND,
        action_details: {
          request_id: requestId,
          actor_email: actor.email ?? null,
          target_email: targetEmail,
          ip,
          user_agent: userAgent,
          outcome: 'rejected',
          reason: 'already_active',
          details: authUser?.email_confirmed_at || authUser?.confirmed_at ? 'email_confirmed_at' : 'last_sign_in_at',
          ms: Date.now() - startedAt,
        },
      })

      return noStore(
        NextResponse.json(
          {
            ok: false,
            outcome: 'already_active' as ResendOutcome,
            error: 'ALREADY_ACTIVE',
            next_action: 'reset_password',
            details: 'Account already active. Use password reset instead of invite.',
          },
          { status: 409 },
        ),
      )
    }

    // 7) Resend invite
    const redirectTo = `${getAppUrl()}/auth/complete-invite`

    let inviteMode: 'custom_qr' | 'supabase_default' = 'supabase_default'
    let containsQr = false

    if (process.env.RESEND_API_KEY) {
      const { data: linkData, error: linkErr } = await (admin.auth.admin as any).generateLink({
        type: 'recovery',
        email: targetEmail,
        redirectTo,
      })

      const actionLink = !linkErr ? extractActionLink(linkData) : ''

      if (!linkErr && actionLink) {
        const customEmail = await sendMemberInviteEmailWithQr({
          to: targetEmail,
          actionLink,
          qrValue: prof.qr_code || `atom:${memberUserId}`,
          firstName: prof.first_name ?? null,
          lastName: prof.last_name ?? null,
          memberId: prof.member_id ?? null,
          mode: 'resend',
        })

        if (customEmail.sent) {
          inviteMode = 'custom_qr'
          containsQr = true

          await safeAudit(admin, {
            actor_user_id: actor.id,
            target_user_id: memberUserId,
            action: ACTION_RESEND,
            action_details: {
              request_id: requestId,
              actor_email: actor.email ?? null,
              target_email: targetEmail,
              ip,
              user_agent: userAgent,
              outcome: 'ok',
              details: 'Invite resent with QR email',
              invite_mode: inviteMode,
              ms: Date.now() - startedAt,
            },
          })

          return noStore(
            NextResponse.json({
              ok: true,
              outcome: 'invite_resent' as ResendOutcome,
              invite_mode: inviteMode,
              contains_qr: containsQr,
              email: targetEmail,
              details: 'Invite email with QR code sent.',
            }),
          )
        }
      }
    }

    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(targetEmail, {
      redirectTo,
      data: {
        first_name: prof.first_name ?? null,
        last_name: prof.last_name ?? null,
        phone: prof.phone ?? null,
        role: prof.role ?? 'member',
      },
    })

    if (inviteErr) {
      await safeAudit(admin, {
        actor_user_id: actor.id,
        target_user_id: memberUserId,
        action: ACTION_RESEND,
        action_details: {
          request_id: requestId,
          actor_email: actor.email ?? null,
          target_email: targetEmail,
          ip,
          user_agent: userAgent,
          outcome: 'failed',
          reason: 'invite_failed',
          details: inviteErr.message,
          ms: Date.now() - startedAt,
        },
      })

      const m = String(inviteErr.message || '').toLowerCase()
      if (m.includes('already') || m.includes('registered') || m.includes('confirmed')) {
        return noStore(
          NextResponse.json(
            {
              ok: false,
              outcome: 'already_active' as ResendOutcome,
              error: 'ALREADY_ACTIVE',
              next_action: 'reset_password',
              details: 'Account already active. Use password reset instead of invite.',
            },
            { status: 409 },
          ),
        )
      }

      return noStore(
        NextResponse.json(
          {
            ok: false,
            outcome: 'invite_failed' as ResendOutcome,
            error: 'INVITE_FAILED',
            details: inviteErr.message,
          },
          { status: 500 },
        ),
      )
    }

    await safeAudit(admin, {
      actor_user_id: actor.id,
      target_user_id: memberUserId,
      action: ACTION_RESEND,
      action_details: {
        request_id: requestId,
        actor_email: actor.email ?? null,
        target_email: targetEmail,
        ip,
        user_agent: userAgent,
        outcome: 'ok',
        details: 'Invite resent',
        invite_mode: inviteMode,
        ms: Date.now() - startedAt,
      },
    })

    return noStore(
      NextResponse.json({
        ok: true,
        outcome: 'invite_resent' as ResendOutcome,
        invite_mode: inviteMode,
        contains_qr: containsQr,
        invite_sent: true,
        user_id: memberUserId,
        email: targetEmail,
        next_action: 'wait_for_activation',
        message: 'Invite email sent.',
      }),
    )
  } catch (e: any) {
    console.error('members/[id]/resend-invite error:', e)

    // best effort audit
    await safeAudit(admin, {
      actor_user_id: actorIdForAudit,
      target_user_id: memberUserId,
      action: ACTION_RESEND,
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
      NextResponse.json(
        {
          ok: false,
          outcome: 'invite_failed' as ResendOutcome,
          error: 'SERVER_ERROR',
          details: e?.message || String(e),
        },
        { status: 500 },
      ),
    )
  }
}
