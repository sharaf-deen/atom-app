// src/app/api/members/create/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import type { Role } from '@/lib/session'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createClient } from '@supabase/supabase-js'

type Body =
  | {
      email?: string
      firstName?: string
      lastName?: string
      phone?: string
      first_name?: string
      last_name?: string
      date_of_birth?: string
      dateOfBirth?: string
      dob?: string
    }
  | Record<string, any>

const STAFF: Role[] = ['reception', 'admin', 'super_admin']
const can = (r: Role) => STAFF.includes(r)

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function todayDateOnlyUTC() {
  return new Date().toISOString().slice(0, 10)
}

function isValidDateOnly(dateOnly: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return false
  const [y, m, d] = dateOnly.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (isNaN(dt.getTime())) return false
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

function normalizeEmail(raw: any) {
  const e = String(raw ?? '').trim().toLowerCase()
  return e || ''
}

function normalizeOptionalText(raw: any) {
  const s = String(raw ?? '').trim()
  return s ? s : null
}

function isUUID(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
}

function getClientIP(req: Request) {
  const xf = req.headers.get('x-forwarded-for')
  if (xf) return xf.split(',')[0].trim()
  return req.headers.get('x-real-ip') || null
}

function sanitizeAppUrl(u: string) {
  const s = String(u || '').trim()
  return s ? s.replace(/\/$/, '') : ''
}

export async function POST(req: Request) {
  let auditId: number | null = null
  let newUserId: string | null = null

  try {
    const supa = createSupabaseServerActionClient()

    // 1) Auth actor (staff only)
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

    // 2) Payload + normalization
    const body = (await req.json()) as Body

    const email = normalizeEmail((body as any).email)
    const first_name = normalizeOptionalText((body as any).first_name ?? (body as any).firstName)
    const last_name = normalizeOptionalText((body as any).last_name ?? (body as any).lastName)
    const phone = normalizeOptionalText((body as any).phone)

    const dobRaw = String(
      (body as any).date_of_birth ?? (body as any).dateOfBirth ?? (body as any).dob ?? '',
    ).trim()
    const date_of_birth = dobRaw ? dobRaw : null

    if (!email) {
      return noStore(NextResponse.json({ ok: false, error: 'MISSING_EMAIL' }, { status: 400 }))
    }

    if (date_of_birth) {
      if (!isValidDateOnly(date_of_birth)) {
        return noStore(NextResponse.json({ ok: false, error: 'INVALID_DATE_OF_BIRTH' }, { status: 400 }))
      }
      const today = todayDateOnlyUTC()
      if (date_of_birth > today) {
        return noStore(NextResponse.json({ ok: false, error: 'DATE_OF_BIRTH_IN_FUTURE' }, { status: 400 }))
      }
    }

    // 3) Admin client (service role)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) {
      return noStore(NextResponse.json({ ok: false, error: 'SERVER_MISCONFIGURED' }, { status: 500 }))
    }

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // 4) DB check (fast): if profile exists -> 409
    {
      const { data: existing, error: existingErr } = await admin
        .from('profiles')
        .select('user_id, role')
        .eq('email', email)
        .maybeSingle()

      if (existingErr) {
        return noStore(
          NextResponse.json(
            { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: existingErr.message },
            { status: 500 },
          ),
        )
      }

      if (existing?.user_id) {
        return noStore(
          NextResponse.json(
            {
              ok: false,
              error: 'EMAIL_ALREADY_EXISTS',
              existing_user_id: existing.user_id,
              existing_role: (existing as any).role ?? null,
              details: 'A user with this email already exists. Please search the member and open their profile instead.',
            },
            { status: 409 },
          ),
        )
      }
    }

    // 5) Auth check (no listUsers): if auth user exists -> 409
    {
      const { data: authId, error: authLookupErr } = await admin.rpc('auth_user_id_by_email', {
        p_email: email,
      })

      if (authLookupErr) {
        return noStore(
          NextResponse.json(
            { ok: false, error: 'AUTH_LOOKUP_FAILED', details: authLookupErr.message },
            { status: 500 },
          ),
        )
      }

      if (authId) {
        return noStore(
          NextResponse.json(
            {
              ok: false,
              error: 'EMAIL_ALREADY_EXISTS',
              existing_user_id: String(authId),
              details: 'A user with this email already exists. Please search the member and open their profile instead.',
            },
            { status: 409 },
          ),
        )
      }
    }

    // 6) Rate limit + audit reserve (ex: 3/hour) BEFORE sending email
    {
      const ip = getClientIP(req)
      const ua = req.headers.get('user-agent')

      const { data: rlData, error: rlErr } = await admin.rpc('reserve_email_audit', {
        p_kind: 'invite',
        p_email: email,
        p_member_user_id: null,
        p_actor_user_id: actor.id,
        p_ip: ip,
        p_user_agent: ua,
        // p_limit: 3,
        // p_window_seconds: 3600,
      })

      if (rlErr) {
        return noStore(
          NextResponse.json({ ok: false, error: 'RATE_LIMIT_CHECK_FAILED', details: rlErr.message }, { status: 500 }),
        )
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
    }

    // 7) redirectTo for invite completion
    const APP_URL = sanitizeAppUrl(
      process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
    )
    const redirectTo = `${APP_URL}/auth/complete-invite`

    // 8) Invite user (creates auth.users + sends email)
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { first_name, last_name, phone, role: 'member' },
    })

    if (inviteErr || !invited?.user?.id) {
      // if invite failed because user exists, return 409 (and finalize audit as failed)
      let existsId: string | null = null
      try {
        const { data: authId2 } = await admin.rpc('auth_user_id_by_email', { p_email: email })
        if (authId2) existsId = String(authId2)
      } catch {}

      if (auditId) {
        await admin.rpc('finalize_email_audit', {
          p_audit_id: auditId,
          p_ok: false,
          p_error: existsId ? 'EMAIL_ALREADY_EXISTS' : (inviteErr?.message ?? 'invite_failed'),
          p_member_user_id: existsId && isUUID(existsId) ? existsId : null,
        })
      }

      if (existsId) {
        return noStore(
          NextResponse.json(
            {
              ok: false,
              error: 'EMAIL_ALREADY_EXISTS',
              existing_user_id: existsId,
              details: 'A user with this email already exists. Please search the member and open their profile instead.',
            },
            { status: 409 },
          ),
        )
      }

      return noStore(
        NextResponse.json(
          { ok: false, error: 'CREATE_USER_FAILED', details: inviteErr?.message ?? 'unknown' },
          { status: 500 },
        ),
      )
    }

    newUserId = invited.user.id

    // 9) Insert/Upsert profile (onConflict user_id). DB will still block duplicate emails.
    const { error: profErr } = await admin.from('profiles').upsert(
      {
        user_id: newUserId,
        email, // normalized
        first_name,
        last_name,
        phone,
        date_of_birth,
        role: 'member',
        qr_code: `atom:${newUserId}`,
      },
      { onConflict: 'user_id' },
    )

    // Finalize audit as "sent" (email was sent). We pass member_user_id so profile last_invite can be updated if row exists.
    if (auditId) {
      await admin.rpc('finalize_email_audit', {
        p_audit_id: auditId,
        p_ok: true,
        p_error: null,
        p_member_user_id: newUserId,
      })
    }

    if (profErr) {
      // If unique email violation (race), return 409 (email might have been sent already)
      if ((profErr as any)?.code === '23505') {
        return noStore(
          NextResponse.json(
            {
              ok: false,
              error: 'EMAIL_ALREADY_EXISTS',
              details:
                'A user with this email already exists. Please search the member and open their profile instead.',
            },
            { status: 409 },
          ),
        )
      }

      return noStore(
        NextResponse.json({ ok: false, error: `PROFILE_INSERT_FAILED: ${profErr.message}` }, { status: 500 }),
      )
    }

    return noStore(
      NextResponse.json({
        ok: true,
        user_id: newUserId,
        user: { id: newUserId, email, first_name, last_name, phone, date_of_birth },
        message: 'Member invited and profile saved.',
      }),
    )
  } catch (e: any) {
    const msg = e?.message || String(e)

    // If we reserved an audit slot, finalize it as failed (best effort)
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (auditId && url && serviceKey) {
        const admin = createClient(url, serviceKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        })
        await admin.rpc('finalize_email_audit', {
          p_audit_id: auditId,
          p_ok: false,
          p_error: msg,
          p_member_user_id: newUserId,
        })
      }
    } catch {}

    console.error('members/create error:', e)
    return noStore(
      NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: msg }, { status: 500 }),
    )
  }
}
