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

    // 1) Actor auth (staff only)
    const { data: authData, error: authErr } = await supa.auth.getUser()
    if (authErr) return noStore(NextResponse.json({ ok: false, error: `AUTH_ERROR: ${authErr.message}` }, { status: 401 }))
    const actor = authData.user
    if (!actor) return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))

    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', actor.id)
      .maybeSingle<{ role: Role | null }>()
    if (meErr) return noStore(NextResponse.json({ ok: false, error: `ACTOR_PROFILE_ERROR: ${meErr.message}` }, { status: 500 }))

    const role = (me?.role ?? 'member') as Role
    if (!can(role)) return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))

    // 2) Parse & normalize payload (accept camelCase and snake_case)
    const body = (await req.json()) as Body
    const email = String(body.email || '').trim().toLowerCase()
    const first_name = (String(body.first_name ?? body.firstName ?? '').trim() || null) as string | null
    const last_name = (String(body.last_name ?? body.lastName ?? '').trim() || null) as string | null
    const phone = (String(body.phone ?? '').trim() || null) as string | null

    if (!email) return noStore(NextResponse.json({ ok: false, error: 'MISSING_EMAIL' }, { status: 400 }))

    // 3) Admin client (Service Role)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) {
      return noStore(NextResponse.json({ ok: false, error: 'SERVER_MISCONFIGURED' }, { status: 500 }))
    }
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

    // 4) Soft check: profile already exists by email → update missing names/phone then return
    {
      const { data: existing } = await admin
        .from('profiles')
        .select('user_id, first_name, last_name, phone')
        .ilike('email', email)
        .maybeSingle<{ user_id: string; first_name: string | null; last_name: string | null; phone: string | null }>()
      if (existing?.user_id) {
        // Si on a reçu des valeurs, on met à jour (on n’écrase pas par vide)
        const patch: Record<string, any> = {}
        if (first_name) patch.first_name = first_name
        if (last_name) patch.last_name = last_name
        if (phone) patch.phone = phone
        if (Object.keys(patch).length > 0) {
          await admin.from('profiles').update(patch).eq('user_id', existing.user_id)
        }
        return noStore(NextResponse.json({ ok: true, user_id: existing.user_id, updated: Object.keys(patch) }))
      }
    }

    // 5) Invite user (auth.users)
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      'http://localhost:3000'
    const redirectTo = `${appUrl}/auth/callback`

    let userId: string | null = null
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { first_name, last_name, phone, role: 'member' },
    })

    if (!inviteErr && invited?.user?.id) {
      userId = invited.user.id
    } else {
      // Si l’email existe déjà côté Auth, on récupère son id
      const { data: existingAuth, error: authLookupErr } = await admin
        // ts-expect-error - schema() est supporté par PostgREST client
        .schema('auth')
        .from('users')
        .select('id, email')
        .eq('email', email)
        .maybeSingle<{ id: string; email: string }>()
      if (authLookupErr || !existingAuth?.id) {
        return noStore(NextResponse.json(
          { ok: false, error: `CREATE_USER_FAILED: ${inviteErr?.message ?? 'unknown'}` },
          { status: 500 }
        ))
      }
      userId = existingAuth.id
    }

    // 6) Upsert profile row with names/phone + qr_code
    const { error: profErr } = await admin
      .from('profiles')
      .upsert(
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
      return noStore(NextResponse.json({ ok: false, error: `PROFILE_INSERT_FAILED: ${profErr.message}` }, { status: 500 }))
    }

    return noStore(NextResponse.json({
      ok: true,
      user_id: userId,
      user: { id: userId, email, first_name, last_name, phone },
      message: 'Member invited and profile saved.',
    }))
  } catch (e: any) {
    console.error('members/create error:', e)
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) }, { status: 500 }))
  }
}
