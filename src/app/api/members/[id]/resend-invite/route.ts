// src/app/api/members/[id]/resend-invite/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import type { Role } from '@/lib/session'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createClient } from '@supabase/supabase-js'

const STAFF: Role[] = ['reception', 'admin', 'super_admin']
const can = (r: Role) => STAFF.includes(r)

const ACTION_RESEND = 'member_invite_resend'

// Rate limit (par acteur)
const RL_RESEND_LIMIT = 10
const RL_RESEND_WINDOW_MIN = 10

// Anti-spam (par membre ciblé)
const RL_RESEND_PER_TARGET_LIMIT = 3
const RL_RESEND_PER_TARGET_WINDOW_HOURS = 24

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

async function safeAudit(admin: any, row: any) {
  try {
    await admin.from('audit_logs').insert(row)
  } catch {
    // audit ne doit jamais casser le flux
  }
}

async function countActions(
  admin: any,
  where: Record<string, any>,
  sinceISO: string,
) {
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

export async function POST(
  req: Request,
  ctx: { params: { id: string } },
) {
  const ip = getIp(req)
  const userAgent = getUA(req)

  const memberUserId = String(ctx?.params?.id ?? '').trim()
  if (!isUuid(memberUserId)) {
    return noStore(
      NextResponse.json({ ok: false, error: 'INVALID_MEMBER_ID' }, { status: 400 }),
    )
  }

  try {
    // 1) Auth acteur (staff uniquement)
    const supa = createSupabaseServerActionClient()
    const { data: authData, error: authErr } = await supa.auth.getUser()

    if (authErr) {
      return noStore(
        NextResponse.json(
          { ok: false, error: `AUTH_ERROR: ${authErr.message}` },
          { status: 401 },
        ),
      )
    }

    const actor = authData.user
    if (!actor) {
      return noStore(
        NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }),
      )
    }

    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', actor.id)
      .maybeSingle()

    if (meErr) {
      return noStore(
        NextResponse.json(
          { ok: false, error: `ACTOR_PROFILE_ERROR: ${meErr.message}` },
          { status: 500 },
        ),
      )
    }

    const role = (me?.role ?? 'member') as Role
    if (!can(role)) {
      return noStore(
        NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }),
      )
    }

    // 2) Service role
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) {
      return noStore(
        NextResponse.json({ ok: false, error: 'SERVER_MISCONFIGURED' }, { status: 500 }),
      )
    }

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // 3) Rate limit (par acteur)
    {
      const since = new Date(Date.now() - RL_RESEND_WINDOW_MIN * 60 * 1000).toISOString()
      const n = await countActions(
        admin,
        { actor_user_id: actor.id, action: ACTION_RESEND },
        since,
      )

      if (n !== null && n >= RL_RESEND_LIMIT) {
        await safeAudit(admin, {
          actor_user_id: actor.id,
          target_user_id: memberUserId,
          action: ACTION_RESEND,
          action_details: {
            actor_email: actor.email ?? null,
            ip,
            user_agent: userAgent,
            outcome: 'blocked',
            details: `rate_limited (${RL_RESEND_LIMIT}/${RL_RESEND_WINDOW_MIN}min)`,
          },
        })

        const res = NextResponse.json(
          { ok: false, error: 'RATE_LIMITED', details: 'Too many resend attempts. Please try again later.' },
          { status: 429 },
        )
        res.headers.set('Retry-After', String(RL_RESEND_WINDOW_MIN * 60))
        return noStore(res)
      }
    }

    // 4) Profil cible
    const { data: prof, error: profErr } = await admin
      .from('profiles')
      .select('user_id, email, first_name, last_name, phone, role')
      .eq('user_id', memberUserId)
      .maybeSingle()

    if (profErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'PROFILE_LOOKUP_FAILED', details: profErr.message }, { status: 500 }),
      )
    }
    if (!prof?.user_id) {
      return noStore(NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 }))
    }

    const targetEmail = normalizeEmail(prof.email)
    if (!targetEmail) {
      return noStore(NextResponse.json({ ok: false, error: 'MEMBER_HAS_NO_EMAIL' }, { status: 400 }))
    }

    // 5) Anti-spam (par membre ciblé)
    {
      const since = new Date(Date.now() - RL_RESEND_PER_TARGET_WINDOW_HOURS * 60 * 60 * 1000).toISOString()
      const n = await countActions(
        admin,
        { actor_user_id: actor.id, action: ACTION_RESEND, target_user_id: memberUserId },
        since,
      )

      if (n !== null && n >= RL_RESEND_PER_TARGET_LIMIT) {
        await safeAudit(admin, {
          actor_user_id: actor.id,
          target_user_id: memberUserId,
          action: ACTION_RESEND,
          action_details: {
            actor_email: actor.email ?? null,
            target_email: targetEmail,
            ip,
            user_agent: userAgent,
            outcome: 'blocked',
            details: `target_rate_limited (${RL_RESEND_PER_TARGET_LIMIT}/${RL_RESEND_PER_TARGET_WINDOW_HOURS}h)`,
          },
        })

        const res = NextResponse.json(
          { ok: false, error: 'RATE_LIMITED', details: 'Too many resends for this member. Try later.' },
          { status: 429 },
        )
        res.headers.set('Retry-After', String(RL_RESEND_PER_TARGET_WINDOW_HOURS * 60 * 60))
        return noStore(res)
      }
    }

    // 6) Si déjà actif -> on refuse (il faut "reset password" dans ce cas)
    let authUser: any = null
    try {
      const r = await (admin.auth.admin as any).getUserById(memberUserId)
      authUser = r?.data?.user ?? null
    } catch {
      // ignore
    }

    const confirmedAt = authUser?.email_confirmed_at || authUser?.confirmed_at
    if (confirmedAt) {
      await safeAudit(admin, {
        actor_user_id: actor.id,
        target_user_id: memberUserId,
        action: ACTION_RESEND,
        action_details: {
          actor_email: actor.email ?? null,
          target_email: targetEmail,
          ip,
          user_agent: userAgent,
          outcome: 'rejected',
          details: 'ALREADY_ACTIVE (email_confirmed_at)',
        },
      })

      return noStore(
        NextResponse.json(
          { ok: false, error: 'ALREADY_ACTIVE', details: 'Account already active. Use password reset instead of invite.' },
          { status: 409 },
        ),
      )
    }

    // 7) Resend invite
    const APP_URL =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      'http://localhost:3000'

    const redirectTo = `${APP_URL.replace(/\/$/, '')}/auth/complete-invite`

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
          actor_email: actor.email ?? null,
          target_email: targetEmail,
          ip,
          user_agent: userAgent,
          outcome: 'failed',
          details: `INVITE_FAILED: ${inviteErr.message}`,
        },
      })

      return noStore(
        NextResponse.json({ ok: false, error: 'INVITE_FAILED', details: inviteErr.message }, { status: 500 }),
      )
    }

    await safeAudit(admin, {
      actor_user_id: actor.id,
      target_user_id: memberUserId,
      action: ACTION_RESEND,
      action_details: {
        actor_email: actor.email ?? null,
        target_email: targetEmail,
        ip,
        user_agent: userAgent,
        outcome: 'ok',
        details: 'Invite resent',
      },
    })

    return noStore(
      NextResponse.json({
        ok: true,
        user_id: memberUserId,
        email: targetEmail,
        message: 'Invite resent.',
      }),
    )
  } catch (e: any) {
    console.error('members/[id]/resend-invite error:', e)
    return noStore(
      NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) }, { status: 500 }),
    )
  }
}
