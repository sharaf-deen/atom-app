// src/app/api/members/search/route.ts
import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

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
  const q = normalizeQ(searchParams.get('q'))
  const qDigits = digitsOnly(q)

  // Pagination
  const limitParam = Number(searchParams.get('limit') || 50)
  const pageParam = Number(searchParams.get('page') || 1)
  const limit = Math.min(Math.max(limitParam, 1), 200)
  const page = Math.max(pageParam, 1)
  const from = (page - 1) * limit
  const to = from + limit - 1

  try {
    const supabase = createSupabaseServerActionClient()

    // ⚠️ Filtre RÔLE: on force 'member'
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
      .eq('role', 'member')                // ⬅️ ICI: on limite aux membres
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
        // Utilise la colonne normalisée si tu l'as créée (voir notes ci-dessous)
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

    const items: MemberRow[] =
      (data ?? []).map((r: any) => ({
        user_id: r.user_id,
        email: r.email ?? null,
        first_name: r.first_name ?? null,
        last_name: r.last_name ?? null,
        phone: r.phone ?? null,
        role: (r.role ?? null) as Role | null,
        created_at: r.created_at ?? null,
        member_id: r.member_id ?? null,
      })) ?? []

    return NextResponse.json({ ok: true, items, page, limit, total: count ?? null })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
