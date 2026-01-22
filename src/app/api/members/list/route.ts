// src/app/api/members/list/route.ts
import { NextResponse } from 'next/server'
import { createSupabaseRSC } from '@/lib/supabaseServer'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 200

type Status = 'all' | 'active' | 'inactive'

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

export async function GET(req: Request) {
  try {
    const supabase = createSupabaseRSC()
    const url = new URL(req.url)

    const statusRaw = (url.searchParams.get('status') || 'all').toLowerCase()
    const status = (['all', 'active', 'inactive'] as const).includes(statusRaw as any)
      ? (statusRaw as Status)
      : null

    if (!status) {
      return NextResponse.json({ ok: false, error: 'Invalid status. Use all|active|inactive.' }, { status: 400 })
    }

    const page = intParam(url.searchParams.get('page'), 1, 1, 1_000_000)
    const limit = intParam(url.searchParams.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT)
    const from = (page - 1) * limit
    const to = from + limit - 1

    const today = new Date().toISOString().slice(0, 10) // 'YYYY-MM-DD'

    // ALL members (role='member')
    if (status === 'all') {
      const { data, error, count } = await supabase
        .from('profiles')
        .select('user_id, email, first_name, last_name, phone, role, created_at, member_id', {
          count: 'exact',
          head: false,
        })
        .eq('role', 'member')
        .order('created_at', { ascending: false })
        .range(from, to)

      if (error) {
        console.error('Error fetching members (all):', error)
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      }

      const items = (data ?? []) as MemberRow[]
      return NextResponse.json(
        {
          ok: true,
          status,
          items,
          total: typeof count === 'number' ? count : items.length,
          page,
          pageSize: limit,
        },
        { status: 200 },
      )
    }

    // ACTIVE / INACTIVE: compute active IDs from subscriptions
    const { data: subs, error: subsError } = await supabase
      .from('subscriptions')
      .select('member_id, end_date, status')
      .eq('status', 'active')
      .gte('end_date', today)

    if (subsError) {
      console.error('Error fetching subscriptions (list):', subsError)
      return NextResponse.json({ ok: false, error: subsError.message }, { status: 500 })
    }

    const activeIds = new Set<string>()
    for (const row of subs ?? []) {
      const mid = (row as any)?.member_id as string | null
      if (mid) activeIds.add(mid)
    }

    // ACTIVE list
    if (status === 'active') {
      const ids = Array.from(activeIds)
      if (ids.length === 0) {
        return NextResponse.json(
          { ok: true, status, items: [], total: 0, page, pageSize: limit },
          { status: 200 },
        )
      }

      const { data, error, count } = await supabase
        .from('profiles')
        .select('user_id, email, first_name, last_name, phone, role, created_at, member_id', {
          count: 'exact',
          head: false,
        })
        .eq('role', 'member')
        .in('user_id', ids)
        .order('created_at', { ascending: false })
        .range(from, to)

      if (error) {
        console.error('Error fetching members (active):', error)
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      }

      const items = (data ?? []) as MemberRow[]
      return NextResponse.json(
        {
          ok: true,
          status,
          items,
          total: typeof count === 'number' ? count : items.length,
          page,
          pageSize: limit,
        },
        { status: 200 },
      )
    }

    // INACTIVE list
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('user_id, email, first_name, last_name, phone, role, created_at, member_id')
      .eq('role', 'member')
      .order('created_at', { ascending: false })

    if (profilesError) {
      console.error('Error fetching profiles (inactive list):', profilesError)
      return NextResponse.json({ ok: false, error: profilesError.message }, { status: 500 })
    }

    const allProfiles = (profiles ?? []) as MemberRow[]
    const inactiveProfiles = allProfiles.filter((p) => !activeIds.has(p.user_id))
    const total = inactiveProfiles.length
    const items = inactiveProfiles.slice(from, from + limit)

    return NextResponse.json(
      {
        ok: true,
        status,
        items,
        total,
        page,
        pageSize: limit,
      },
      { status: 200 },
    )
  } catch (e: any) {
    console.error('Unexpected error in /api/members/list:', e)
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
