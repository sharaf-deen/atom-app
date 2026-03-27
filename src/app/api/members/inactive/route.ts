// src/app/api/members/inactive/route.ts
import { NextResponse } from 'next/server'
import { createSupabaseRSC } from '@/lib/supabaseServer'
import { cairoTodayDateOnly } from '@/lib/cairoTime'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function isISODateOnly(s?: string | null) {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function isFrozenNow(sub: {
  subscription_type?: string | null
  end_date?: string | null
  frozen_from?: string | null
  frozen_until?: string | null
}, today: string) {
  const st = (sub.subscription_type ?? (sub.end_date ? 'time' : 'sessions')) as 'time' | 'sessions'
  if (st !== 'time') return false
  const until = isISODateOnly(sub.frozen_until) ? (sub.frozen_until as string) : null
  if (!until) return false
  const from = isISODateOnly(sub.frozen_from) ? (sub.frozen_from as string) : null
  return from ? today >= from && today < until : today < until
}


const DEFAULT_LIMIT = 20
const MAX_LIMIT = 200

type Role = 'member' | 'assistant_coach' | 'coach' | 'reception' | 'admin' | 'super_admin'

type MemberRow = {
  user_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  role: Role | null
  created_at: string | null
  member_id: string | null
}

function intParam(raw: string | null, fallback: number, min: number, max: number) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  const i = Math.floor(n)
  return Math.min(Math.max(i, min), max)
}

/**
 * Retourne la liste des membres INACTIFS (pas d'abonnement actif en cours)
 *
 * GET /api/members/inactive?page=1&limit=20
 */
export async function GET(req: Request) {
  try {
    const supabase = createSupabaseRSC()
    const url = new URL(req.url)

    const page = intParam(url.searchParams.get('page'), 1, 1, 1_000_000)
    const limit = intParam(url.searchParams.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT)

    const from = (page - 1) * limit
    const today = cairoTodayDateOnly()

    // 1) Tous les membres (role='member')
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('user_id, email, first_name, last_name, phone, role, created_at, member_id')
      .eq('role', 'member')
      .order('created_at', { ascending: false })

    if (profilesError) {
      console.error('Error fetching profiles (inactive):', profilesError)
      return NextResponse.json({ ok: false, error: profilesError.message }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
    }

    // 2) Abonnements actifs
    const { data: subs, error: subsError } = await supabase
      .from('subscriptions')
      .select('member_id, end_date, status, subscription_type, frozen_from, frozen_until')
      .eq('status', 'active')
      .gte('end_date', today)

    if (subsError) {
      console.error('Error fetching subscriptions (inactive):', subsError)
      return NextResponse.json({ ok: false, error: subsError.message }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
    }

    const activeIds = new Set<string>()
    for (const row of subs ?? []) {
      const memberId = (row as any).member_id as string | null
      if (!memberId) continue
      if (isFrozenNow(row as any, today)) continue
      activeIds.add(memberId)
    }

    // 3) Filtrer les inactifs
    const allProfiles = (profiles ?? []) as MemberRow[]
    const inactiveProfiles = allProfiles.filter((p) => !activeIds.has(p.user_id))

    const total = inactiveProfiles.length
    const items = inactiveProfiles.slice(from, from + limit)

    return NextResponse.json(
      { ok: true, items, total, page, pageSize: limit },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e: any) {
    console.error('Unexpected error in /api/members/inactive:', e)
    return NextResponse.json(
      {
        ok: false,
        error:
          e?.message ||
          JSON.stringify(e, Object.getOwnPropertyNames(e)) ||
          'Unexpected error',
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}