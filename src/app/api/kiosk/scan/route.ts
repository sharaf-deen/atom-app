// src/app/api/kiosk/scan/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

type Body = { code?: string }

function extractMemberId(raw: string): string | null {
  const t = (raw || '').trim()
  if (!t) return null
  if (t.startsWith('atom:') || t.startsWith('ATOM:')) {
    const id = t.slice(5)
    return /^[0-9a-f-]{36}$/i.test(id) ? id : null
  }
  return /^[0-9a-f-]{36}$/i.test(t) ? t : null
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

const STAFF_CAN_SCAN = ['reception', 'admin', 'super_admin', 'coach', 'assistant_coach'] as const
const STAFF_ALWAYS_VALID = ['reception', 'admin', 'super_admin', 'coach', 'assistant_coach'] as const
type Role = (typeof STAFF_CAN_SCAN)[number] | 'member'

// Helpers pour réponses cohérentes avec champ "message"
function bad(status: number, message: string, extra: Record<string, any> = {}) {
  return noStore(NextResponse.json({ ok: false, message, ...extra }, { status }))
}
function good(payload: Record<string, any>) {
  return noStore(NextResponse.json({ ok: true, ...payload }))
}

export async function POST(req: Request) {
  try {
    // 0) Auth opérateur avec route client (respecte la session)
    const route = createSupabaseServerActionClient()
    const { data: auth, error: authErr } = await route.auth.getUser()
    if (authErr) return bad(401, 'AUTH_ERROR: ' + authErr.message)
    const user = auth.user
    if (!user) return bad(401, 'NOT_AUTHENTICATED')

    const { data: me, error: meErr } = await route
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle<{ role: string | null }>()
    if (meErr) return bad(500, 'PROFILE_LOOKUP_FAILED: ' + meErr.message)

    const myRole = (me?.role ?? 'member') as Role
    if (!STAFF_CAN_SCAN.includes(myRole as any)) {
      return bad(403, 'FORBIDDEN')
    }

    // 1) Lecture du code
    const body = (await req.json().catch(() => ({}))) as Body
    const raw = (body?.code || '').trim()
    if (!raw) return bad(400, 'MISSING_QR')

    // 2) Client admin pour bypass RLS sur le workflow de scan
    const admin = createSupabaseAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY! // ⚠️ Service Role, serveur uniquement
    )

    // 3) Identifier le membre scanné (uuid direct ou lookup par qr_code)
    let member_id = extractMemberId(raw)
    if (!member_id) {
      const { data: prof, error: qrErr } = await admin
        .from('profiles')
        .select('user_id')
        .eq('qr_code', raw)
        .maybeSingle<{ user_id: string }>()
      if (qrErr) return bad(500, 'QR_LOOKUP_FAILED: ' + qrErr.message)
      member_id = prof?.user_id ?? null
    }
    if (!member_id) return bad(400, 'INVALID_QR')

    const today = todayIsoDate()

    // 4) Rôle de la personne SCANNÉE
    const { data: scannedProf, error: scannedErr } = await admin
      .from('profiles')
      .select('role')
      .eq('user_id', member_id)
      .maybeSingle<{ role: string | null }>()
    if (scannedErr) return bad(500, 'SCANNED_PROFILE_LOOKUP_FAILED: ' + scannedErr.message)

    const scannedRole = (scannedProf?.role ?? 'member') as Role

    // 5) Staff scanné => toujours valid
    if (STAFF_ALWAYS_VALID.includes(scannedRole as any)) {
      const { error: insStaffErr } = await admin.from('attendance').insert({
        member_id,
        date: today,                 // si ta colonne a un DEFAULT, tu peux l’omettre
        valid: true,
        subscription_id: null,
        source: 'kiosk_staff',
        scanned_by: user.id,         // si tu as cette colonne
      })
      if (insStaffErr) return bad(500, 'ATTENDANCE_INSERT_ERROR: ' + insStaffErr.message)

      return good({
        valid: true,
        member_id,
        subscription_id: null,
        message: 'OK: STAFF ACCESS',
      })
    }

    // 6) Vérifier abonnements actifs (admin → bypass RLS)
    const { data: subs, error: subsErr } = await admin
      .from('subscriptions')
      .select('id, subscription_type, plan, status, start_date, end_date, sessions_total, sessions_used')
      .eq('member_id', member_id)
      .eq('status', 'active')
      .lte('start_date', today)
      .gte('end_date', today)
      .order('end_date', { ascending: false })
      .limit(50)
    if (subsErr) return bad(500, 'SUBSCRIPTION_LOOKUP_FAILED: ' + subsErr.message)

    // 7) Choisir l’abonnement prioritaire
    let chosen: any = null
    let useSessions = false

    for (const s of subs || []) {
      if (s.subscription_type === 'time') { chosen = s; break }
    }
    if (!chosen) {
      for (const s of subs || []) {
        if (s.subscription_type === 'sessions') {
          const total = Number(s.sessions_total || 0)
          const used = Number(s.sessions_used || 0)
          if (total - used > 0) { chosen = s; useSessions = true; break }
        }
      }
    }

    let valid = !!chosen
    let subscription_id: string | null = chosen?.id ?? null

    // 8) Consommer 1 séance si pack de sessions (avant l’insert attendance)
    if (valid && useSessions && chosen) {
      const nextUsed = Number(chosen.sessions_used || 0) + 1
      const total = Number(chosen.sessions_total || 0)

      const { data: urow, error: incErr } = await admin
        .from('subscriptions')
        .update({ sessions_used: nextUsed })
        .eq('id', chosen.id)
        .filter('sessions_used', 'lt', total) // garde DB
        .select('id')
        .maybeSingle<{ id: string }>()
      if (incErr || !urow?.id) {
        valid = false
        subscription_id = null
      }
    }

    // 9) Insérer l’assiduité
    const { error: insErr } = await admin.from('attendance').insert({
      member_id,
      date: today,
      valid,
      subscription_id,
      source: 'kiosk',
      scanned_by: user.id, // si dispo
    })
    if (insErr) return bad(500, 'ATTENDANCE_INSERT_ERROR: ' + insErr.message)

    // 10) Réponse
    return good({
      valid,
      member_id,
      subscription_id,
      message: valid ? 'OK: subscription valid' : 'No active subscription for today',
    })
  } catch (e: any) {
    return bad(500, e?.message || 'SERVER_ERROR')
  }
}
