// src/app/api/members/stats/route.ts
import { NextResponse } from 'next/server'
import { createSupabaseRSC } from '@/lib/supabaseServer'

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
      .from('profiles') // ta table de membres
      .select('user_id')

    if (profilesError) {
      console.error('Error fetching profiles:', profilesError)
      return NextResponse.json(
        {
          ok: false,
          error: `profiles: ${
            profilesError.message || JSON.stringify(profilesError)
          }`,
        },
        { status: 500 },
      )
    }

    const total = profiles?.length ?? 0

    //
    // 2) Membres avec un abonnement ACTIF
    //
    const { data: subs, error: subsError } = await supabase
      .from('subscriptions')
      .select('member_id, end_date, status')
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
        { status: 500 },
      )
    }

    // On compte les member_id DISTINCTS avec au moins une sub active
    const activeMemberIds = new Set<string>()
    for (const row of subs ?? []) {
      if (row?.member_id) {
        activeMemberIds.add(row.member_id as string)
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
      { status: 200 },
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
      { status: 500 },
    )
  }
}
