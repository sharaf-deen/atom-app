// src/app/api/members/create/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidateTag, revalidatePath } from 'next/cache'
import { canAccessKiosk, normalizeRole, type Role } from '@/lib/rbac'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createClient } from '@supabase/supabase-js'
import { extractActionLink, sendMemberInviteEmailWithQr } from '@/lib/memberInviteEmail'

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

type CreateOutcome =
  | 'invited_new_user'
  | 'existing_profile'
  | 'existing_auth_user'

type InviteMode = 'custom_qr' | 'custom_qr_failed' | 'supabase_default' | 'none'

function isValidDateOnly(dateOnly: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return false
  const [y, m, d] = dateOnly.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (isNaN(dt.getTime())) return false
  // Ensure components match (e.g. 2025-02-30 should fail)
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  )
}

function todayDateOnlyUTC() {
  return new Date().toISOString().slice(0, 10)
}

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

async function findAuthUserByEmail(admin: any, email: string) {
  const target = email.trim().toLowerCase()
  let page = 1
  const perPage = 200

  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) return { user: null, error }

    const users = Array.isArray(data?.users) ? data.users : []
    const match = users.find((u: any) => (u?.email ?? '').toLowerCase() === target) ?? null
    if (match) return { user: match, error: null }
    if (users.length < perPage) return { user: null, error: null }
    page += 1
    if (page > 100) return { user: null, error: null }
  }
}

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    // 1) Auth de l’acteur (staff uniquement)
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

    const role = normalizeRole(me?.role)
    if (!canAccessKiosk(role)) {
      return noStore(
        NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }),
      )
    }

    // 2) Récupération & normalisation du payload
    const body = (await req.json()) as Body

    const email = String(body.email || '').trim().toLowerCase()
    const first_name = (String(body.first_name ?? body.firstName ?? '').trim() ||
      null) as string | null
    const last_name = (String(body.last_name ?? body.lastName ?? '').trim() ||
      null) as string | null
    const phone = (String(body.phone ?? '').trim() || null) as string | null

    const dobRaw = String(
      (body as any).date_of_birth ?? (body as any).dateOfBirth ?? (body as any).dob ?? '',
    ).trim()
    const date_of_birth = (dobRaw || null) as string | null

    if (date_of_birth) {
      if (!isValidDateOnly(date_of_birth)) {
        return noStore(
          NextResponse.json({ ok: false, error: 'INVALID_DATE_OF_BIRTH' }, { status: 400 }),
        )
      }
      const today = todayDateOnlyUTC()
      if (date_of_birth > today) {
        return noStore(
          NextResponse.json({ ok: false, error: 'DATE_OF_BIRTH_IN_FUTURE' }, { status: 400 }),
        )
      }
    }

    if (!email) {
      return noStore(
        NextResponse.json({ ok: false, error: 'MISSING_EMAIL' }, { status: 400 }),
      )
    }

    // 3) Client admin (Service Role)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!url || !serviceKey) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'SERVER_MISCONFIGURED' },
          { status: 500 },
        ),
      )
    }

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // 4) Safety guard: never overwrite an existing member/profile when the email is already used
    {
      const { data: existing, error: existingErr } = await admin
        .from('profiles')
        .select('user_id, member_id, first_name, last_name, email')
        .ilike('email', email)
        .maybeSingle()

      if (existingErr) {
        return noStore(
          NextResponse.json(
            { ok: false, error: `PROFILE_LOOKUP_FAILED: ${existingErr.message}` },
            { status: 500 },
          ),
        )
      }

      if (existing?.user_id) {
        return noStore(
          NextResponse.json(
            {
              ok: false,
              error: 'EMAIL_ALREADY_USED_BY_MEMBER',
              details:
                'This email already belongs to an existing member. Open the existing profile instead of creating a new member.',
              existing_member: {
                user_id: existing.user_id,
                member_id: existing.member_id ?? null,
                first_name: existing.first_name ?? null,
                last_name: existing.last_name ?? null,
                email: existing.email ?? email,
              },
            },
            { status: 409 },
          ),
        )
      }
    }

    const { user: existingAuthUser, error: authLookupErr } = await findAuthUserByEmail(admin, email)
    if (authLookupErr) {
      return noStore(
        NextResponse.json(
          { ok: false, error: `AUTH_LOOKUP_FAILED: ${authLookupErr.message}` },
          { status: 500 },
        ),
      )
    }

    if (existingAuthUser?.id) {
      return noStore(
        NextResponse.json(
          {
            ok: false,
            error: 'EMAIL_ALREADY_USED_BY_AUTH_ACCOUNT',
            details:
              'This email is already attached to another account. Do not create a new member with it. Recover or reconnect the existing account instead.',
          },
          { status: 409 },
        ),
      )
    }

    // 5) URL de redirection pour compléter l’invitation
    const APP_URL =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      'http://localhost:3000'

    const redirectTo = `${APP_URL.replace(/\/$/, '')}/auth/complete-invite`

    // 6) Tentative d’inviter l’utilisateur (email + lien)
    let userId: string | null = null
    let outcome: CreateOutcome = 'invited_new_user'
    let inviteSent = false
    let inviteMode: InviteMode = 'none'
    let containsQr = false
    let inviteWarning: string | null = null
    let customActionLink = ''

    const canUseCustomEmail = !!process.env.RESEND_API_KEY

    if (canUseCustomEmail) {
      const { data: linkData, error: linkErr } = await (admin.auth.admin as any).generateLink({
        type: 'invite',
        email,
        redirectTo,
        data: { first_name, last_name, phone, role: 'member' },
      })

      if (!linkErr) {
        customActionLink = extractActionLink(linkData)
        userId = linkData?.user?.id ?? null

        if (userId) {
          outcome = 'invited_new_user'
          inviteMode = 'custom_qr'
        }
      }
    }

    if (!userId) {
      const { data: invited, error: inviteErr } =
        await admin.auth.admin.inviteUserByEmail(email, {
          redirectTo,
          data: { first_name, last_name, phone, role: 'member' },
        })

      if (!inviteErr && invited?.user?.id) {
        userId = invited.user.id
        outcome = 'invited_new_user'
        inviteSent = true
        inviteMode = 'supabase_default'
      } else {
        const { data: usersData, error: listErr } = await admin.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        })

        const existingAuth =
          usersData?.users?.find(
            (u: any) => u.email && u.email.toLowerCase() === email,
          ) ?? null

        if (listErr || !existingAuth?.id) {
          return noStore(
            NextResponse.json(
              {
                ok: false,
                error: 'CREATE_USER_FAILED',
                details: inviteErr?.message ?? listErr?.message ?? 'unknown',
              },
              { status: 500 },
            ),
          )
        }

        return noStore(
          NextResponse.json(
            {
              ok: false,
              error: 'EMAIL_ALREADY_USED_BY_AUTH_ACCOUNT',
              details:
                'This email is already attached to another account. Do not create a new member with it. Recover or reconnect the existing account instead.',
            },
            { status: 409 },
          ),
        )
      }
    }

    // 7) Sauvegarde dans public.profiles
    // IMPORTANT: On évite un UPSERT direct ici car (selon la configuration DB) un profil peut
    // déjà être créé automatiquement après l’invitation (trigger sur auth.users).
    // Un UPSERT peut provoquer une consommation “inutile” de member_seq si un INSERT est tenté puis
    // converti en UPDATE (ou ignoré), ce qui donne l’impression que les IDs “sautent”.

    const insertRow = {
      user_id: userId!,
      email,
      first_name,
      last_name,
      phone,
      date_of_birth,
      role: 'member',
      qr_code: `atom:${userId}`,
    }

    const updateRow = {
      email,
      first_name,
      last_name,
      phone,
      date_of_birth,
      role: 'member',
      qr_code: `atom:${userId}`,
    }

    const { data: existingById, error: existErr } = await admin
      .from('profiles')
      .select('user_id')
      .eq('user_id', userId!)
      .maybeSingle()

    if (existErr) {
      return noStore(
        NextResponse.json(
          { ok: false, error: `PROFILE_LOOKUP_FAILED: ${existErr.message}` },
          { status: 500 },
        ),
      )
    }

    const profileAction = existingById?.user_id ? 'updated' : 'created'

    if (existingById?.user_id) {
      const { error: updErr } = await admin.from('profiles').update(updateRow).eq('user_id', userId!)
      if (updErr) {
        return noStore(
          NextResponse.json(
            { ok: false, error: `PROFILE_UPDATE_FAILED: ${updErr.message}` },
            { status: 500 },
          ),
        )
      }
    } else {
      const { error: insErr } = await admin.from('profiles').insert(insertRow)
      if (insErr) {
        return noStore(
          NextResponse.json(
            { ok: false, error: `PROFILE_INSERT_FAILED: ${insErr.message}` },
            { status: 500 },
          ),
        )
      }
    }

    const { data: savedProfile } = await admin
      .from('profiles')
      .select('user_id, member_id, qr_code, email, first_name, last_name')
      .eq('user_id', userId!)
      .maybeSingle()

    if (outcome === 'invited_new_user' && inviteMode === 'custom_qr' && customActionLink) {
      const qrValue = savedProfile?.qr_code || `atom:${userId}`
      const customEmail = await sendMemberInviteEmailWithQr({
        to: email,
        actionLink: customActionLink,
        qrValue,
        firstName: savedProfile?.first_name ?? first_name,
        lastName: savedProfile?.last_name ?? last_name,
        memberId: savedProfile?.member_id ?? null,
        mode: 'invite',
      })

      if (customEmail.sent) {
        inviteSent = true
        containsQr = true
        inviteMode = 'custom_qr'
      } else {
        inviteSent = false
        containsQr = false
        inviteMode = 'custom_qr_failed'
        inviteWarning = customEmail.reason ?? 'CUSTOM_INVITE_EMAIL_FAILED'
      }
    }

    try {
      revalidateTag('members')
    } catch {}
    try {
      revalidatePath('/members')
    } catch {}

    return noStore(
      NextResponse.json({
        ok: true,
        outcome,
        invite_sent: inviteSent,
        invite_mode: inviteMode,
        contains_qr: containsQr,
        invite_warning: inviteWarning,
        profile_action: profileAction,
        next_action: inviteSent ? 'none' : 'open_profile',
        user_id: userId,
        user: { id: userId, email, first_name, last_name, phone, date_of_birth },
        message:
          outcome === 'invited_new_user'
            ? inviteMode === 'custom_qr'
              ? 'Member created. Invite email with QR code sent.'
              : inviteMode === 'custom_qr_failed'
                ? 'Member created, but the custom invite email with QR code could not be sent.'
                : 'Member created. Invite email sent.'
            : outcome === 'existing_auth_user'
              ? 'Member profile saved, but no new invite email was sent because the auth account already exists.'
              : 'Existing member found. No invite email was sent.',
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
