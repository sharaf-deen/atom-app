// src/app/api/contact/send/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

import { createClient } from '@supabase/supabase-js'
import type { Role } from '@/lib/session'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

export async function POST(req: Request) {
  try {
    // Client RLS (pour auth + profil de l’expéditeur)
    const route = createSupabaseServerActionClient()
    const { data: auth, error: authErr } = await route.auth.getUser()
    if (authErr) {
      return noStore(NextResponse.json({ ok: false, error: 'AUTH_ERROR', details: authErr.message }, { status: 401 }))
    }
    const user = auth.user
    if (!user) return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))

    // Expéditeur doit être member
    const { data: me, error: meErr } = await route
      .from('profiles')
      .select('role, first_name, last_name, email')
      .eq('user_id', user.id)
      .maybeSingle<{ role: Role | null; first_name: string | null; last_name: string | null; email: string | null }>()
    if (meErr) {
      return noStore(NextResponse.json({ ok: false, error: 'PROFILE_ERROR', details: meErr.message }, { status: 500 }))
    }
    if ((me?.role ?? 'member') !== 'member') {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    // Payload
    const b = await req.json().catch(() => ({} as any))
    const subject: string = (b?.subject || '').toString().trim()
    const message: string = (b?.message || '').toString().trim()
    if (!message) {
      return noStore(NextResponse.json({ ok: false, error: 'MISSING_MESSAGE' }, { status: 400 }))
    }

    // Client Service Role (bypass RLS) — requis pour lister les destinataires et insérer
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) {
      return noStore(NextResponse.json({
        ok: false,
        error: 'SERVER_MISCONFIGURED',
        details: 'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
      }, { status: 500 }))
    }
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

    // Destinataires : super_admins (bypass RLS)
    const { data: supers, error: suErr } = await admin
      .from('profiles')
      .select('user_id')
      .eq('role', 'super_admin')
      .not('user_id', 'is', null)
    if (suErr) {
      return noStore(NextResponse.json({ ok: false, error: 'LOOKUP_FAILED', details: suErr.message }, { status: 500 }))
    }
    let recipients = (supers ?? []).map(r => r.user_id as string).filter(Boolean)

    // Fallback : admins si pas de super_admin
    if (recipients.length === 0) {
      const { data: admins, error: adErr } = await admin
        .from('profiles')
        .select('user_id')
        .eq('role', 'admin')
        .not('user_id', 'is', null)
      if (adErr) {
        return noStore(NextResponse.json({ ok: false, error: 'LOOKUP_FAILED', details: adErr.message }, { status: 500 }))
      }
      recipients = (admins ?? []).map(r => r.user_id as string).filter(Boolean)
      if (recipients.length === 0) {
        return noStore(NextResponse.json({ ok: false, error: 'NO_SUPER_ADMINS_OR_ADMINS' }, { status: 400 }))
      }
    }

    // Contenu notif
    const senderName = [me?.first_name ?? '', me?.last_name ?? ''].join(' ').trim() || me?.email || 'Member'
    const title = subject || `Message from ${senderName}`
    const body = `${message}\n\n---\nFrom: ${senderName}\nReply-to: ${me?.email ?? 'n/a'}`
    const kind = 'member_contact' // utilisé par l’inbox super_admin

    // Insertion (bypass RLS)
    const rows = recipients.map((rid) => ({
      user_id: rid,        // destinataire (super_admin/admin)
      member_id: user.id,  // expéditeur (member)
      created_by: user.id, // expéditeur
      kind,
      title,
      body,
    }))

    let inserted = 0
    const CHUNK = 500
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK)
      const { error } = await admin.from('notifications').insert(slice)
      if (error) {
        return noStore(NextResponse.json({ ok: false, error: 'INSERT_FAILED', details: error.message }, { status: 500 }))
      }
      inserted += slice.length
    }

    return noStore(NextResponse.json({ ok: true, count: inserted }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) }, { status: 500 }))
  }
}
