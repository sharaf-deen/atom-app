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

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function isUUID(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
}

function sanitizeAppUrl(u: string) {
  const s = String(u || '').trim()
  return s ? s.replace(/\/$/, '') : ''
}

function isAlreadyActive(u: any) {
  return Boolean(u?.email_confirmed_at || u?.confirmed_at || u?.last_sign_in_at || u?.user_metadata?.has_password === true)
}

function getClientIP(req: Request) {
  const xf = req.headers.get('x-forwarded-for')
  if (xf) return xf.split(',')[0].trim()
  return req.headers.get('x-real-ip') || null
}

export async function POST(req: Request, ctx: { params: { id: string } }) {
  let auditId: number | null = null

  try {
    const memberUserId = String(ctx?.params?.id || '').trim()
    if (!isUUID(memberUserId)) {
      return noStore(NextResponse.json({ ok: false, error: 'INVALID_MEMBER_ID' }, { status: 400 }))
    }

    const supa = createSupabaseServerActionClient()

    // Auth actor
    const { data: authData, error: authErr } = await supa.auth.getUser()
    if (authErr) {
      return noStore(NextResponse.json({ ok: false, error: `AUTH_ERROR: ${authErr.message}` }, { status: 401 }))
    }
    const actor = authData.user
    if (!actor) {
      return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))
    }

    // Role check
    const { data: me, error: meErr } = await supa.from('profiles').select('role').eq('user_id', actor.id).maybeSingle()
    if (meErr) {
      return noStore(NextResponse.json({ ok: false, error: `ACTOR_PROFILE_ERROR: ${meErr.message}` }, { status: 500 }))
    }
    const role = (me?.role ?? 'member') as Role
    if (!can(role)) {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    // Admin client
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) {
      return noStore(NextResponse.json({ ok: false, error: 'SERVER_MISCONFIGURED' }, { status: 500 }))
    }
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

    // Load profile email
    const { data: profile, error: profErr } = await admin
      .from('profiles')
      .select('user_id, email, first_name, last_name, phone')
      .eq('user_id', memberUserId)
      .maybeSingle()

    if (profErr) {
      return noStore(NextResponse.json({ ok: false, error: 'PROFILE_LOOKUP_FAILED', details: profErr.message }, { status: 500 }))
    }
    if (!profile?.user_id) {
      return noStore(NextResponse.json({ ok: false, error: 'MEMBER_NOT_FOUND' }, { status: 404 }))
    }

    const email = String(profile.email ?? '').trim().toLowerCase()
    if (!email) {
      return noStore(NextResponse.json({ ok: false, error: 'MISSING_MEMBER_EMAIL' }, { status: 400 }))
    }

    // Check auth user status
    const { data: userData, error: userErr } = await admin.auth.admin.getUserById(memberUserId)
    if (userErr) {
      return noStore(NextResponse.json({ ok: false, error: 'AUTH_LOOKUP_FAILED', details: userErr.message }, { status: 500 }))
    }
    const authUser = userData?.user
    if (!authUser?.id) {
      return noStore(NextResponse.json({ ok: false, error: 'AUTH_USER_NOT_FOUND' }, { status: 404 }))
    }
    if (isAlreadyActive(authUser)) {
      return noStore(NextResponse.json({ ok: false, error: 'ALREADY_ACTIVE' }, { status: 409 }))
    }

    // Rate limit + audit reserve (3/hour by default)
    const ip = getClientIP(req)
    const ua = req.headers.get('user-agent')

    const { data: rlData, error: rlErr } = await admin.rpc('reserve_email_audit', {
      p_kind: 'invite',
      p_email: email,
      p_member_user_id: memberUserId,
      p_actor_user_id: actor.id,
      p_ip: ip,
      p_user_agent: ua,
      // p_limit: 3,
      // p_window_seconds: 3600,
    })

    if (rlErr) {
      return noStore(NextResponse.json({ ok: false, error: 'RATE_LIMIT_CHECK_FAILED', details: rlErr.message }, { status: 500 }))
    }

    const rlRow = Array.isArray(rlData) ? rlData[0] : rlData
    if (!rlRow?.allowed) {
      return noStore(
        NextResponse.json(
          {
            ok: false,
            error: 'RATE_LIMITED',
            reset_at: rlRow?.reset_at ?? null,
            remaining: rlRow?.remaining ?? 0,
          },
          { status: 429 },
        ),
      )
    }

    auditId = Number(rlRow.audit_id)

    // redirectTo
    const APP_URL = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000')
    const redirectTo = `${APP_URL}/auth/complete-invite`

    // Send invite (try 1)
    let ok = false
    let lastErr: string | null = null

    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: {
        first_name: profile.first_name ?? null,
        last_name: profile.last_name ?? null,
        phone: profile.phone ?? null,
        role: 'member',
      },
    })

    if (!inviteErr) {
      ok = true
    } else {
      lastErr = inviteErr.message

      // Fallback: GoTrue resend endpoint
      const r = await fetch(`${url}/auth/v1/resend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          type: 'invite',
          email,
          options: { email_redirect_to: redirectTo },
        }),
      })

      if (r.ok) {
        ok = true
      } else {
        const txt = await r.text().catch(() => '')
        lastErr = `${lastErr} | gotrue_resend_failed: ${txt || 'unknown'}`
      }
    }

    // Finalize audit
    if (auditId) {
      await admin.rpc('finalize_email_audit', {
        p_audit_id: auditId,
        p_ok: ok,
        p_error: ok ? null : lastErr ?? 'unknown',
        p_member_user_id: memberUserId,
      })
    }

    if (!ok) {
      return noStore(NextResponse.json({ ok: false, error: 'RESEND_INVITE_FAILED', details: lastErr ?? 'unknown' }, { status: 500 }))
    }

    return noStore(NextResponse.json({ ok: true, message: 'Invite email sent.', email, redirectTo }))
  } catch (e: any) {
    const msg = e?.message || String(e)

    // finalize audit as failure if reserved
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (auditId && url && serviceKey) {
        const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
        await admin.rpc('finalize_email_audit', {
          p_audit_id: auditId,
          p_ok: false,
          p_error: msg,
        })
      }
    } catch {}

    console.error('members/resend-invite error:', e)
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: msg }, { status: 500 }))
  }
}
