// src/app/api/members/create/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidateTag, revalidatePath } from 'next/cache'
import type { Role } from '@/lib/session'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createClient } from '@supabase/supabase-js'
import { sendMemberInviteEmailWithQr, type InviteEmailMode } from '@/lib/memberInviteEmail'

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

const STAFF: Role[] = ['reception', 'admin', 'super_admin']
const can = (r: Role) => STAFF.includes(r)

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

    const role = (me?.role ?? 'member') as Role
    if (!can(role)) {
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

    // 4) Si un profile existe déjà pour cet email → on met juste à jour les infos
    {
      const { data: existing } = await admin
        .from('profiles')
        .select('user_id, first_name, last_name, phone, date_of_birth')
        .ilike('email', email)
        .maybeSingle()

      if (existing?.user_id) {
        const patch: Record<string, any> = {}
        if (first_name) patch.first_name = first_name
        if (last_name) patch.last_name = last_name
        if (phone) patch.phone = phone
        if (date_of_birth) patch.date_of_birth = date_of_birth

        if (Object.keys(patch).length > 0) {
          await admin.from('profiles').update(patch).eq('user_id', existing.user_id)
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
            outcome: 'existing_profile' as CreateOutcome,
            invite_sent: false,
            profile_action: Object.keys(patch).length > 0 ? 'updated' : 'unchanged',
            next_action: 'open_profile',
            user_id: existing.user_id,
            user: {
              id: existing.user_id,
              email,
              first_name,
              last_name,
              phone,
              date_of_birth,
            },
            message:
              Object.keys(patch).length > 0
                ? 'Existing member found. Profile updated. No invite email was sent.'
                : 'This member already exists. No invite email was sent.',
          }),
        )
      }
    }

    // 5) URL de redirection pour compléter l’invitation
    const APP_URL =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      'http://localhost:3000'

    const redirectTo = `${APP_URL.replace(/\/$/, '')}/auth/complete-invite`

    // 6) Tentative d’inviter l’utilisateur
    //    - si Resend est configuré : on génère nous-mêmes le lien d’invitation pour envoyer un email custom avec QR
    //    - sinon : fallback sur l’invitation standard Supabase
    let userId: string | null = null
    let outcome: CreateOutcome = 'invited_new_user'
    let inviteSent = false
    let inviteEmailMode: InviteEmailMode = 'none'
    let generatedInviteLink: string | null = null
    let inviteDetails: string | null = null
    let usedCustomInviteFlow = false

    if (process.env.RESEND_API_KEY) {
      const { data: generated, error: generateErr } = await (admin.auth.admin as any).generateLink({
        type: 'invite',
        email,
        options: {
          redirectTo,
          data: { first_name, last_name, phone, role: 'member' },
        },
      })

      const generatedUserId =
        generated?.user?.id ??
        generated?.properties?.user?.id ??
        null

      const actionLink =
        generated?.properties?.action_link ??
        generated?.properties?.actionLink ??
        generated?.action_link ??
        generated?.actionLink ??
        null

      if (!generateErr && generatedUserId) {
        userId = generatedUserId
        outcome = 'invited_new_user'
        generatedInviteLink = actionLink
        usedCustomInviteFlow = true
      } else {
        inviteDetails = generateErr?.message ?? null
      }
    }

    if (!userId) {
      const { data: invited, error: inviteErr } =
        await admin.auth.admin.inviteUserByEmail(email, {
          redirectTo,
          data: { first_name, last_name, phone, role: 'member' },
        })

      if (!inviteErr && invited?.user?.id) {
        // Cas standard : Supabase envoie l’email d’invitation
        userId = invited.user.id
        outcome = 'invited_new_user'
        inviteSent = true
        inviteEmailMode = 'supabase_default'
      } else {
        // Cas où l’utilisateur existe déjà dans Auth → on le cherche par email
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
                details: inviteErr?.message ?? inviteDetails ?? listErr?.message ?? 'unknown',
              },
              { status: 500 },
            ),
          )
        }

        userId = existingAuth.id
        outcome = 'existing_auth_user'
        inviteSent = false
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

    // 8) Si on a généré un lien custom, on envoie maintenant notre email avec le QR code
    if (usedCustomInviteFlow && outcome === 'invited_new_user') {
      const { data: profileForInvite } = await admin
        .from('profiles')
        .select('member_id, qr_code, first_name, last_name')
        .eq('user_id', userId!)
        .maybeSingle<{
          member_id: string | null
          qr_code: string | null
          first_name: string | null
          last_name: string | null
        }>()

      const qrValue = profileForInvite?.qr_code ?? `atom:${userId}`

      if (generatedInviteLink) {
        const emailResult = await sendMemberInviteEmailWithQr({
          to: email,
          inviteLink: generatedInviteLink,
          qrValue,
          memberId: profileForInvite?.member_id ?? null,
          firstName: profileForInvite?.first_name ?? first_name,
          lastName: profileForInvite?.last_name ?? last_name,
          appUrl: APP_URL,
        })

        if (emailResult.sent) {
          inviteSent = true
          inviteEmailMode = 'custom_qr'
          inviteDetails = null
        } else {
          inviteSent = false
          inviteEmailMode = 'none'
          inviteDetails = emailResult.reason
        }
      } else {
        inviteSent = false
        inviteEmailMode = 'none'
        inviteDetails = inviteDetails || 'INVITE_LINK_MISSING'
      }
    }

    try {
      revalidateTag('members')
    } catch {}
    try {
      revalidatePath('/members')
    } catch {}

    const message =
      outcome === 'invited_new_user'
        ? inviteEmailMode === 'custom_qr'
          ? 'Member created. Invite email with QR code sent.'
          : inviteEmailMode === 'supabase_default'
            ? 'Member created. Invite email sent.'
            : 'Member created, but the invite email could not be sent. Open the member profile to resend the invite.'
        : outcome === 'existing_auth_user'
          ? 'Member profile saved, but no new invite email was sent because the auth account already exists.'
          : 'Existing member found. No invite email was sent.'

    return noStore(
      NextResponse.json({
        ok: true,
        outcome,
        invite_sent: inviteSent,
        invite_email_mode: inviteEmailMode,
        invite_details: inviteDetails,
        profile_action: profileAction,
        next_action: inviteSent ? 'none' : 'open_profile',
        user_id: userId,
        user: { id: userId, email, first_name, last_name, phone, date_of_birth },
        message,
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
