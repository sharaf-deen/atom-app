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

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    // 1) Auth de l’acteur (staff uniquement)
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

    // 2) Payload + normalisation
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

    // 3) Client admin (Service Role)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!url || !serviceKey) {
      return noStore(NextResponse.json({ ok: false, error: 'SERVER_MISCONFIGURED' }, { status: 500 }))
    }

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // 4) Check rapide en DB (index-friendly): si profile existe -> 409 (pas d'invite)
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

    // 5) redirectTo pour compléter l’invitation
    const APP_URL =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      'http://localhost:3000'

    const redirectTo = `${APP_URL.replace(/\/$/, '')}/auth/complete-invite`

    // 6) Invite (création auth.users) + fallback (auth lookup via RPC)
    let userId: string | null = null

    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { first_name, last_name, phone, role: 'member' },
    })

    if (!inviteErr && invited?.user?.id) {
      userId = invited.user.id
    } else {
      // Fallback: check auth.users via SQL function (no listUsers)
      const { data: authId, error: authLookupErr } = await admin.rpc('auth_user_id_by_email', {
        p_email: email,
      })

      if (authLookupErr) {
        return noStore(
          NextResponse.json(
            {
              ok: false,
              error: 'CREATE_USER_FAILED',
              details: inviteErr?.message ?? authLookupErr.message ?? 'unknown',
            },
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

      return noStore(
        NextResponse.json(
          {
            ok: false,
            error: 'CREATE_USER_FAILED',
            details: inviteErr?.message ?? 'unknown',
          },
          { status: 500 },
        ),
      )
    }

    // 7) Insert profile (onConflict user_id). Handle race unique on email (23505).
    const { error: profErr } = await admin
      .from('profiles')
      .upsert(
        {
          user_id: userId!,
          email, // déjà normalisé (lower/trim)
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
      // unique violation (email unique / indexes uniques)
      if ((profErr as any)?.code === '23505') {
        return noStore(
          NextResponse.json(
            {
              ok: false,
              error: 'EMAIL_ALREADY_EXISTS',
              details: 'A user with this email already exists. Please search the member and open their profile instead.',
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
        user_id: userId,
        user: { id: userId, email, first_name, last_name, phone, date_of_birth },
        message: 'Member invited and profile saved.',
      }),
    )
  } catch (e: any) {
    console.error('members/create error:', e)
    return noStore(
      NextResponse.json(
        { ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) },
        { status: 500 },
      ),
    )
  }
}
