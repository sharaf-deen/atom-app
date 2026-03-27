// src/app/api/coaches/list/route.ts
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { canAccessCoaches, normalizeRole } from '@/lib/rbac'
import { clampInt, sanitizeSearch } from '@/lib/inputGuard'

type Role = 'coach' | 'assistant_coach'
type Kind = 'all' | 'coach' | 'assistant_coach'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function normalizeQ(raw: string | null): string {
  return sanitizeSearch(raw, { max: 80 })
}

function digitsOnly(s: string): string {
  return s.replace(/\D+/g, '')
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const kindRaw = (searchParams.get('kind') || 'all').trim().toLowerCase()
  const kind: Kind = kindRaw === 'coach' || kindRaw === 'assistant_coach' ? kindRaw : 'all'
  const q = normalizeQ(searchParams.get('q'))
  const qDigits = digitsOnly(q)

  const limit = clampInt(searchParams.get('limit'), 20, 1, 200)
  const page = clampInt(searchParams.get('page'), 1, 1, 1_000_000)
  const from = (page - 1) * limit
  const to = from + limit - 1

  const roles: Role[] =
    kind === 'coach' ? ['coach'] : kind === 'assistant_coach' ? ['assistant_coach'] : ['coach', 'assistant_coach']

  try {
    const supabase = createSupabaseServerActionClient()

    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError) {
      return noStore(NextResponse.json({ ok: false, error: authError.message }, { status: 401 }))
    }
    const me = authData.user
    if (!me) {
      return noStore(NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 }))
    }

    const { data: meProfile, error: meErr } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', me.id)
      .maybeSingle()

    if (meErr) {
      return noStore(NextResponse.json({ ok: false, error: meErr.message }, { status: 403 }))
    }

    const myRole = normalizeRole(meProfile?.role)
    if (!canAccessCoaches(myRole)) {
      return noStore(NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 }))
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
      const esc = q.replace(/%/g, '\\%').replace(/_/g, '\\_')
      const ors: string[] = [
        `first_name.ilike.%${esc}%`,
        `last_name.ilike.%${esc}%`,
        `email.ilike.%${esc}%`,
        `member_id.ilike.%${esc}%`,
        `phone.ilike.%${esc}%`,
      ]

      if (qDigits.length >= 4) {
        ors.push(`phone_digits.ilike.%${qDigits}%`)
      }

      if (UUID_RE.test(q)) {
        ors.push(`user_id.eq.${q}`)
      }

      qb = qb.or(ors.join(','))
    }

    const { data, error, count } = await qb
    if (error) {
      return noStore(NextResponse.json({ ok: false, error: error.message }, { status: 400 }))
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

    return noStore(NextResponse.json({ ok: true, items, page, limit, total: Number(count ?? 0) }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 }))
  }
}
