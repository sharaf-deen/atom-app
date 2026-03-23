// src/app/api/members/stats/route.ts
import { NextResponse } from 'next/server'
import { createSupabaseRSC } from '@/lib/supabaseServer'

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


/**
 * Stats globales des membres :
 *  - total    : nombre total de membres (table profiles)
 *  - active   : nombre de membres ayant AU MOINS
 *               un abonnement actif :
 *                  subscriptions.status = 'active'
 *                  ET subscriptions.end_date >= aujourd'hui
 *  - inactive : total - active
 */
export async function GET() {
  try {
    const supabase = createSupabaseRSC()
    const today = new Date().toISOString().slice(0, 10) // 'YYYY-MM-DD'

    //
    // 1) Total de membres : table "profiles"
    //
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles') // members profiles
      .select('user_id, role')
      .in('role', ['member', 'champion', 'vip'])

    if (profilesError) {
      console.error('Error fetching profiles:', profilesError)
      return NextResponse.json(
        {
          ok: false,
          error: `profiles: ${
            profilesError.message || JSON.stringify(profilesError)
          }`,
        },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const total = profiles?.length ?? 0

    // Only count subscriptions that belong to a real member profile
    const memberIds = new Set<string>((profiles ?? []).map((p: any) => p.user_id as string).filter(Boolean))
    const activeMemberIds = new Set<string>()
    for (const profile of profiles ?? []) {
      const role = String((profile as any)?.role ?? '')
      if (role === 'champion' || role === 'vip') {
        const id = (profile as any)?.user_id as string | undefined
        if (id) activeMemberIds.add(id)
      }
    }

    //
    // 2) Membres avec un abonnement ACTIF
    //
    const { data: subs, error: subsError } = await supabase
      .from('subscriptions')
      .select('member_id, end_date, status, subscription_type, frozen_from, frozen_until')
      .eq('status', 'active')
      .gte('end_date', today) // end_date >= aujourd'hui

    if (subsError) {
      console.error('Error fetching subscriptions:', subsError)
      return NextResponse.json(
        {
          ok: false,
          error: `subscriptions: ${
            subsError.message || JSON.stringify(subsError)
          }`,
        },
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    // On compte les member_id DISTINCTS avec au moins une sub active
    for (const row of subs ?? []) {
      if (row?.member_id) {
        const mid = row.member_id as string
        if (!memberIds.has(mid)) continue
        if (isFrozenNow(row as any, today)) continue
        activeMemberIds.add(mid)
      }
    }

    const active = activeMemberIds.size
    const inactive = Math.max(total - active, 0)

    return NextResponse.json(
      {
        ok: true,
        total,
        active,
        inactive,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e: any) {
    console.error('Unexpected error in /api/members/stats:', e)
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