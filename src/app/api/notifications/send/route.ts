// src/app/api/notifications/send/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

import { createClient } from '@supabase/supabase-js'

type Audience =
  | 'all_members'
  | 'all_coaches'
  | 'all_assistant_coaches'
  | 'all_staff' // coaches + assistants
  | 'custom'

type Body = {
  title?: string
  body: string
  audience: Audience
  kind?: string           // ex: info, order_update, billing, promo
  user_ids?: string[]     // custom/pick
  emails?: string[]       // custom/emails
}

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

const SENDER_ROLES = new Set(['admin', 'super_admin'])
// ⚠️ Doit rester synchronisé avec la contrainte SQL notifications_kind_check
const ALLOWED_KINDS = new Set(['info', 'order_update', 'billing', 'promo'])

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    // 1) Auth + rôle
    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) {
      return noStore(NextResponse.json({ ok: false, error: 'AUTH_ERROR', details: authErr.message }, { status: 401 }))
    }
    const user = auth.user
    if (!user) return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))

    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle<{ role: string | null }>()
    if (meErr) {
      return noStore(NextResponse.json({ ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message }, { status: 500 }))
    }
    if (!me?.role || !SENDER_ROLES.has(me.role)) {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    // 2) Payload
    const b = (await req.json()) as Body
    const msg = (b.body ?? '').trim()
    if (!msg) return noStore(NextResponse.json({ ok: false, error: 'MISSING_BODY' }, { status: 400 }))
    const title = (b.title ?? '').trim() || null

    // Sanitize kind (aligne-toi avec la contrainte SQL)
    const kRaw = (b.kind ?? '').trim().toLowerCase()
    const kind = ALLOWED_KINDS.has(kRaw) ? kRaw : 'info'

    const audience = b.audience

    // 3) Construire la liste des destinataires (user_id)
    const recipientIds = new Set<string>()

    async function addFromRoles(roles: string[]) {
      const { data, error } = await supa
        .from('profiles')
        .select('user_id')
        .in('role', roles)
        .not('user_id', 'is', null)
        .limit(100000)
      if (error) throw new Error(error.message)
      for (const r of data ?? []) {
        if (r.user_id) recipientIds.add(r.user_id)
      }
    }

    if (audience === 'all_members') {
      await addFromRoles(['member'])
    } else if (audience === 'all_coaches') {
      await addFromRoles(['coach'])
    } else if (audience === 'all_assistant_coaches') {
      await addFromRoles(['assistant_coach'])
    } else if (audience === 'all_staff') {
      await addFromRoles(['coach', 'assistant_coach'])
    } else if (audience === 'custom') {
      const ids = Array.isArray(b.user_ids) ? b.user_ids.filter(Boolean) : []
      ids.forEach((id) => recipientIds.add(id))

      const mails = Array.isArray(b.emails) ? b.emails.map((s) => s.trim().toLowerCase()).filter(Boolean) : []
      if (mails.length > 0) {
        const { data, error } = await supa
          .from('profiles')
          .select('user_id, email')
          .in('email', mails)
          .not('user_id', 'is', null)
          .limit(100000)
        if (error) throw new Error(error.message)
        for (const r of data ?? []) {
          if (r.user_id) recipientIds.add(r.user_id)
        }
      }

      if (recipientIds.size === 0) {
        return noStore(NextResponse.json({ ok: false, error: 'NO_RECIPIENTS' }, { status: 400 }))
      }
    } else {
      return noStore(NextResponse.json({ ok: false, error: 'INVALID_AUDIENCE' }, { status: 400 }))
    }

    // 4) Insert en masse dans public.notifications
    // ⚠️ Si ta table a NOT NULL sur member_id → on met member_id = user_id (destinataire)
    const rows = Array.from(recipientIds).map((uid) => ({
      user_id: uid,        // destinataire
      member_id: uid,      // pour satisfaire NOT NULL si requis par le schéma
      title,
      body: msg,
      created_by: user.id, // expéditeur
      kind,
    }))

    // Utiliser Service Role si dispo pour éviter les blocages RLS
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY
    const client = url && service
      ? createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } })
      : supa

    let inserted = 0
    const CHUNK = 500
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK)
      const { error } = await client.from('notifications').insert(slice)
      if (error) {
        return noStore(NextResponse.json({ ok: false, error: 'INSERT_FAILED', details: error.message }, { status: 500 }))
      }
      inserted += slice.length
    }

    return noStore(NextResponse.json({ ok: true, count: inserted }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: e?.message || 'SERVER_ERROR' }, { status: 500 }))
  }
}
