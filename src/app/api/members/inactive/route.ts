// src/app/api/members/inactive/route.ts
import { NextResponse } from 'next/server'
import { createSupabaseRSC } from '@/lib/supabaseServer'

const PAGE_SIZE = 20

/**
 * Retourne la liste des membres INACTIFS (pas d'abonnement actif en cours),
 * paginée par 20 éléments.
 *
 * GET /api/members/inactive?page=1
 *
 * Réponse:
 *  {
 *    ok: true,
 *    items: MemberRow[],
 *    total: number,
 *    page: number,
 *    pageSize: number
 *  }
 */
export async function GET(req: Request) {
  try {
    const supabase = createSupabaseRSC()
    const url = new URL(req.url)
    const pageParam = url.searchParams.get('page') || '1'
    const pageRaw = parseInt(pageParam, 10)
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1

    const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

    // 1) Récupérer tous les membres (profiles)
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select(
        'user_id, email, first_name, last_name, phone, role, created_at, member_id',
      )

    if (profilesError) {
      console.error('Error fetching profiles (inactive):', profilesError)
      return NextResponse.json(
        {
          ok: false,
          error:
            profilesError.message ||
            JSON.stringify(profilesError, Object.getOwnPropertyNames(profilesError)),
        },
        { status: 500 },
      )
    }

    // 2) Récupérer les abonnements ACTIFS
    const { data: subs, error: subsError } = await supabase
      .from('subscriptions')
      .select('member_id, end_date, status')
      .eq('status', 'active')
      .gte('end_date', today)

    if (subsError) {
      console.error('Error fetching subscriptions (inactive):', subsError)
      return NextResponse.json(
        {
          ok: false,
          error:
            subsError.message ||
            JSON.stringify(subsError, Object.getOwnPropertyNames(subsError)),
        },
        { status: 500 },
      )
    }

    const activeIds = new Set<string>()
    for (const row of subs ?? []) {
      const memberId = (row as any).member_id as string | null
      if (memberId) activeIds.add(memberId)
    }

    // 3) Filtrer les membres inactifs (user_id NON présent dans activeIds)
    const allProfiles = (profiles ?? []) as any[]
    const inactiveProfiles = allProfiles.filter(
      (p) => !activeIds.has(p.user_id as string),
    )

    const total = inactiveProfiles.length

    const start = (page - 1) * PAGE_SIZE
    const end = start + PAGE_SIZE
    const items = inactiveProfiles.slice(start, end)

    return NextResponse.json(
      {
        ok: true,
        items,
        total,
        page,
        pageSize: PAGE_SIZE,
      },
      { status: 200 },
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
      { status: 500 },
    )
  }
}
