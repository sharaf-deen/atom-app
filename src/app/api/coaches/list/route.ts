// src/app/api/coaches/list/route.ts
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { canAccessCoaches, normalizeRole } from '@/lib/rbac'

type Role = 'coach' | 'assistant_coach'
type Kind = 'all' | 'coach' | 'assistant_coach'

function normalizeQ(raw: string | null): string {
  return (raw ?? '').trim()
}

function digitsOnly(s: string): string {
  return s.replace(/\D+/g, '')
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const kind = (searchParams.get('kind') || 'all') as Kind
  const q = normalizeQ(searchParams.get('q'))
  const qDigits = digitsOnly(q)

  // Pagination
  const limitParam = Number(searchParams.get('limit') || 20)
  const pageParam = Number(searchParams.get('page') || 1)
  const limit = Math.min(Math.max(limitParam, 1), 200)
  const page = Math.max(pageParam, 1)
  const from = (page - 1) * limit
  const to = from + limit - 1

  const roles: Role[] =
    kind === 'coach' ? ['coach'] : kind === 'assistant_coach' ? ['assistant_coach'] : ['coach', 'assistant_coach']

  try {
    const supabase = createSupabaseServerActionClient()

    // Auth check
    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError) {
      return NextResponse.json({ ok: false, error: authError.message }, { status: 401 })
    }
    const me = authData.user
    if (!me) {
      return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 })
    }

    // Role check (profiles)
    const { data: meProfile, error: meErr } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', me.id)
      .maybeSingle()

    if (meErr) {
      return NextResponse.json({ ok: false, error: meErr.message }, { status: 403 })
    }

    const myRole = normalizeRole(meProfile?.role)
    if (!canAccessCoaches(myRole)) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
    }

    let qb = supabase
      .from('profiles')
      .select(
        `
        user_id,
        email,
        first_name,
        last_name,
        phone,
        role,
        created_at,
        member_id
      `,
        { count: 'exact', head: false }
      )
      .in('role', roles)
      .order('created_at', { ascending: false })
      .range(from, to)

    if (q) {
      const ors: string[] = [
        `first_name.ilike.%${q}%`,
        `last_name.ilike.%${q}%`,
        `email.ilike.%${q}%`,
        `member_id.ilike.%${q}%`,
        `phone.ilike.%${q}%`,
      ]

      if (qDigits.length >= 4) {
        // Optional normalized phone digits column (if present)
        ors.push(`phone_digits.ilike.%${qDigits}%`)
      }

      if (UUID_RE.test(q)) {
        ors.push(`user_id.eq.${q}`)
      }

      qb = qb.or(ors.join(','))
    }

    const { data, error, count } = await qb
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
    }

    const items = (data ?? []).map((r: any) => ({
      user_id: r.user_id,
      email: r.email ?? null,
      first_name: r.first_name ?? null,
      last_name: r.last_name ?? null,
      phone: r.phone ?? null,
      role: (r.role ?? null) as Role | null,
      created_at: r.created_at ?? null,
      member_id: r.member_id ?? null,
    }))

    const res = NextResponse.json({ ok: true, items, page, limit, total: count ?? null })
    res.headers.set('Cache-Control', 'no-store')
    return res
  } catch (e: any) {
    const res = NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
    res.headers.set('Cache-Control', 'no-store')
    return res
  }
}
