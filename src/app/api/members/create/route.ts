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

function getAppUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '')
}

function getIP(req: Request) {
  const xf = req.headers.get('x-forwarded-for')
  if (xf) return xf.split(',')[0].trim()
  return req.headers.get('x-real-ip') || null
}

async function safeAudit(admin: any, payload: any) {
  // Ne doit jamais casser la route si audit_logs absent
  try {
    await admin.from('audit_logs').insert(payload)
  } catch {}
}

async function rateLimitCount(admin: any, filters: { actor?: string; target?: string; action: string; sinceISO: string }) {
  try {
    let q = admin
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('action', filters.action)
      .gte('created_at', filters.sinceISO)

    if (filters.actor) q = q.eq('actor_user_id', filters.actor)
    if (filters.target) q = q.eq('target_user_id', filters.target)

    const { count, error } = await q
    if (error) return null
    return count ?? 0
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  const startedAt = Date.now()
  const ip = getIP(req)

  // Service Role client (admin)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_MISCONFIGURED' }, { status: 500 }))
  }
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    const supa = createSupabaseServerActionClient()

    // 1) Auth acteur (staff)
    const { data: authData, error: authErr } = await supa.auth.getUser()
    if (authErr) {
      return noStore(NextResponse.json({ ok: false, error: `AUTH_ERROR: ${authErr.message}` }, { status: 401 }))
    }
    const actor = authData.user
    if (!actor) {
      return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))
    }

    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role,email')
      .eq('user_id', actor.id)
      .maybeSingle()

    if (meErr) {
      return noStore(NextResponse.json({ ok: false, error: `ACTOR_PROFILE_ERROR: ${meErr.message}` }, { status: 500 }))
    }

    const role = (me?.role ?? 'member') as Role
    if (!can(role)) {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    // 2) Rate limit (anti spam) : max 30 créations / heure / staff
    {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const n = await rateLimitCount(admin, {
        actor: actor.id,
        action: 'member.create',
        sinceISO: oneHourAgo,
      })
      if (typeof n === 'number' && n >= 30) {
        return noStore(
          NextResponse.json(
            { ok: false, error: 'RATE_LIMITED', details: 'Too many member creations. Please wait and try again.' },
            { status: 429 },
          ),
        )
      }
    }

    // 3) Payload normalisé
    const body = (await req.json()) as Body
    const email = normalizeEmail((body as any).email)
    const first_name = normalizeOptionalText((body as any).first_name ?? (body as any).firstName)
    const last_name = normalizeOptionalText((body as any).last_name ?? (body as any).lastName)
    const phone = normalizeOptionalText((body as any).phone)

    const dobRaw = String((body as any).date_of_birth ?? (body as any).dateOfBirth ?? (body as any).dob ?? '').trim()
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

    // 4) Si profile existe déjà -> 409
    {
      const { data: existing, error: existingErr } = await admin
        .from('profiles')
        .select('user_id, role')
        .eq('email', email)
        .maybeSingle()

      if (existingErr) {
        return noStore(
          NextResponse.json({ ok: false, error: 'PROFILE_LOOKUP_FAILED', details: existingErr.message }, { status: 500 }),
        )
      }

      if (existing?.user_id) {
        await safeAudit(admin, {
          actor_user_id: actor.id,
          target_user_id: existing.user_id,
          action: 'member.create_conflict',
          action_details: { email, actor_role: role, ip },
        })
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

    // 5) redirectTo
    const redirectTo = `${getAppUrl()}/auth/complete-invite`

    // 6) Invite (email Supabase) + fallback auth lookup
    let userId: string | null = null
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { first_name, last_name, phone, role: 'member' },
    })

    if (!inviteErr && invited?.user?.id) {
      userId = invited.user.id
    } else {
      // Fallback (si ton RPC existe)
      const { data: authId, error: rpcErr } = await admin.rpc('auth_user_id_by_email', { p_email: email })

      // Si function absente -> fallback ultime listUsers (rare)
      if (rpcErr && String(rpcErr.message || '').toLowerCase().includes('schema cache')) {
        const { data: usersData, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
        if (listErr) {
          return noStore(
            NextResponse.json(
              { ok: false, error: 'CREATE_USER_FAILED', details: listErr.message ?? inviteErr?.message ?? 'unknown' },
              { status: 500 },
            ),
          )
        }
        const existingAuth =
          usersData?.users?.find((u: any) => u.email && u.email.toLowerCase() === email) ?? null

        if (existingAuth?.id) {
          await safeAudit(admin, {
            actor_user_id: actor.id,
            target_user_id: existingAuth.id,
            action: 'member.create_conflict_auth',
            action_details: { email, actor_role: role, ip, invite_error: inviteErr?.message ?? null },
          })
          return noStore(
            NextResponse.json(
              { ok: false, error: 'EMAIL_ALREADY_EXISTS', existing_user_id: existingAuth.id },
              { status: 409 },
            ),
          )
        }

        return noStore(
          NextResponse.json({ ok: false, error: 'CREATE_USER_FAILED', details: inviteErr?.message ?? 'unknown' }, { status: 500 }),
        )
      }

      if (rpcErr) {
        return noStore(
          NextResponse.json(
            { ok: false, error: 'CREATE_USER_FAILED', details: inviteErr?.message ?? rpcErr.message ?? 'unknown' },
            { status: 500 },
          ),
        )
      }

      if (authId) {
        await safeAudit(admin, {
          actor_user_id: actor.id,
          target_user_id: String(authId),
          action: 'member.create_conflict_auth',
          action_details: { email, actor_role: role, ip, invite_error: inviteErr?.message ?? null },
        })
        return noStore(
          NextResponse.json(
            { ok: false, error: 'EMAIL_ALREADY_EXISTS', existing_user_id: String(authId) },
            { status: 409 },
          ),
        )
      }

      return noStore(
        NextResponse.json({ ok: false, error: 'CREATE_USER_FAILED', details: inviteErr?.message ?? 'unknown' }, { status: 500 }),
      )
    }

    // 7) Upsert profile (unique email race -> 23505)
    const { error: profErr } = await admin
      .from('profiles')
      .upsert(
        {
          user_id: userId!,
          email,
          first_name,
          last_name,
          phone,
          date_of_birth,
          role: 'member',
          qr_code: `atom:${userId}`,
        },
        { onConflict: 'user_id' },
      )

    if (profErr) {
      if ((profErr as any)?.code === '23505') {
        await safeAudit(admin, {
          actor_user_id: actor.id,
          target_user_id: userId!,
          action: 'member.create_conflict_db',
          action_details: { email, actor_role: role, ip, pg: { code: (profErr as any)?.code, message: profErr.message } },
        })
        return noStore(
          NextResponse.json({ ok: false, error: 'EMAIL_ALREADY_EXISTS' }, { status: 409 }),
        )
      }
      return noStore(NextResponse.json({ ok: false, error: `PROFILE_INSERT_FAILED: ${profErr.message}` }, { status: 500 }))
    }

    await safeAudit(admin, {
      actor_user_id: actor.id,
      target_user_id: userId!,
      action: 'member.create',
      action_details: { email, actor_role: role, ip, ms: Date.now() - startedAt },
    })

    return noStore(
      NextResponse.json({
        ok: true,
        user_id: userId,
        user: { id: userId, email, first_name, last_name, phone, date_of_birth },
        message: 'Member invited and profile saved.',
      }),
    )
  } catch (e: any) {
    // best effort audit (no target)
    try {
      const msg = String(e?.message || e)
      await safeAudit(admin, {
        actor_user_id: null,
        target_user_id: '00000000-0000-0000-0000-000000000000',
        action: 'member.create_failed',
        action_details: { error: msg, ip },
      })
    } catch {}

    console.error('members/create error:', e)
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) }, { status: 500 }))
  }
}
