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
    }
  | Record<string, any>

const STAFF: Role[] = ['reception', 'admin', 'super_admin']
const can = (r: Role) => STAFF.includes(r)

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    // 1) Auth de l’acteur : uniquement staff
    const { data: authData, error: authErr } = await supa.auth.getUser()
    if (authErr) {
      return noStore(
        NextResponse.json(
          { ok: false, error: `AUTH_ERROR: ${authErr.message}` },
          { status: 401 }
        )
      )
    }
    const actor = authData.user
    if (!actor) {
      return noStore(
        NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 })
      )
    }

    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', actor.id)
      .maybeSingle<{ role: Role | null }>()
    if (meErr) {
      return noStore(
        NextResponse.json(
          { ok: false, error: `ACTOR_PROFILE_ERROR: ${meErr.message}` },
          { status: 500 }
        )
      )
    }

    const role = (me?.role ?? 'member') as Role
    if (!can(role)) {
      return noStore(
        NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 })
      )
    }

    // 2) Payload (camelCase + snake_case)
    const body = (await req.json()) as Body
    const email = String(body.email || '').trim().toLowerCase()
    const first_name = (String(body.first_name ?? body.firstName ?? '').trim() || null) as
      | string
      | null
    const last_name = (String(body.last_name ?? body.lastName ?? '').trim() || null) as
      | string
      | null
    const phone = (String(body.phone ?? '').trim() || null) as string | null

    if (!email) {
      return noStore(
        NextResponse.json({ ok: false, error: 'MISSING_EMAIL' }, { status: 400 })
      )
    }

    // 3) Client admin (Service Role)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) {
      return noStore(
        NextResponse.json({ ok: false, error: 'SERVER_MISCONFIGURED' }, { status: 500 })
      )
    }
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // 4) Si un profil existe déjà dans public.profiles avec cet email
    {
      const { data: existing } = await admin
        .from('profiles')
        .select('user_id, first_name, last_name, phone')
        .ilike('email', email)
        .maybeSingle<{
          user_id: string
          first_name: string | null
          last_name: string | null
          phone: string | null
        }>()

      if (existing?.user_id) {
        const patch: Record<string, any> = {}
        if (first_name) patch.first_name = first_name
        if (last_name) patch.last_name = last_name
        if (phone) patch.phone = phone

        if (Object.keys(patch).length > 0) {
          await admin.from('profiles').update(patch).eq('user_id', existing.user_id)
        }

        return noStore(
          NextResponse.json({
            ok: true,
            user_id: existing.user_id,
            updated: Object.keys(patch),
            message: 'Existing member updated (no new invite sent).',
          })
        )
      }
    }

    // 5) URL de l’app + redirection spécifique pour compléter l’invite
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      'http://localhost:3000'

    const redirectTo = `${appUrl.replace(/\/$/, '')}/auth/complete-invite`

    let userId: string | null = null

    // 6) On tente d’inviter l’utilisateur (envoi de l’email avec lien)
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
      email,
      {
        redirectTo,
        data: { first_name, last_name, phone, role: 'member' },
      }
    )

    if (!inviteErr && invited?.user?.id) {
      // Cas normal : nouvel utilisateur créé dans auth.users
      userId = invited.user.id
    } else {
      // Cas où un utilisateur existe déjà côté Auth → on le récupère via listUsers + filtre email
      const { data: usersData, error: listErr } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 100,
      })

      const existingAuth = usersData?.users?.find(
        (u) => u.email?.toLowerCase() === email
      )

      if (listErr || !existingAuth?.id) {
        return noStore(
          NextResponse.json(
            {
              ok: false,
              error: 'CREATE_USER_FAILED',
              details: inviteErr?.message ?? listErr?.message ?? 'unknown',
            },
            { status: 500 }
          )
        )
      }

      userId = existingAuth.id
    }

    // 7) Upsert dans public.profiles
    const { error: profErr } = await admin.from('profiles').upsert(
      {
        user_id: userId!,
        email,
        first_name,
        last_name,
        phone,
        role: 'member',
        qr_code: `atom:${userId}`,
      },
      { onConflict: 'user_id' }
    )

    if (profErr) {
      return noStore(
        NextResponse.json(
          { ok: false, error: `PROFILE_INSERT_FAILED: ${profErr.message}` },
          { status: 500 }
        )
      )
    }

    return noStore(
      NextResponse.json({
        ok: true,
        user_id: userId,
        user: { id: userId, email, first_name, last_name, phone },
        message: 'Member invited and profile saved.',
      })
    )
  } catch (e: any) {
    console.error('members/create error:', e)
    return noStore(
      NextResponse.json(
        { ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) },
        { status: 500 }
      )
    )
  }
}
