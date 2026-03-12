// src/app/api/members/search/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { getSessionUser, type Role } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

type MemberRow = {
  user_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  role: Role | null
  created_at: string | null
  member_id: string | null
  date_of_birth: string | null
  is_active?: boolean | null
}

const ALLOWED: Role[] = ['coach', 'reception', 'admin', 'super_admin']

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

function normalizeQ(raw: string | null): string {
  return (raw ?? '').trim()
}

function digitsOnly(s: string): string {
  return s.replace(/\D+/g, '')
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(req: Request) {
  const me = await getSessionUser()

  if (!me) {
    return NextResponse.json(
      { ok: false, error: 'NOT_AUTHENTICATED' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  if (!ALLOWED.includes(me.role)) {
    return NextResponse.json(
      { ok: false, error: 'FORBIDDEN' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const { searchParams } = new URL(req.url)
  const q = normalizeQ(searchParams.get('q'))
  const qDigits = digitsOnly(q)

  const limitParam = Number(searchParams.get('limit') || 50)
  const pageParam = Number(searchParams.get('page') || 1)
  const limit = Math.min(Math.max(limitParam, 1), 200)
  const page = Math.max(pageParam, 1)
  const from = (page - 1) * limit
  const to = from + limit - 1

  try {
    const admin = createSupabaseAdminClient()
    const today = new Date().toISOString().slice(0, 10)

    let qb = admin
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
        member_id,
        date_of_birth
      `,
        { count: 'exact' },
      )
      .eq('role', 'member')
      .order('created_at', { ascending: false })
      .range(from, to)

    if (q) {
      const ors: string[] = [
        `first_name.ilike.%${q}%`,
        `last_name.ilike.%${q}%`,
        `member_id.ilike.%${q}%`,
      ]

      if (me.role !== 'coach') {
        ors.push(`email.ilike.%${q}%`)
        ors.push(`phone.ilike.%${q}%`)
        if (qDigits.length >= 4) {
          ors.push(`phone_digits.ilike.%${qDigits}%`)
        }
      }

      if (UUID_RE.test(q)) {
        ors.push(`user_id.eq.${q}`)
      }

      qb = qb.or(ors.join(','))
    }

    const { data, error, count } = await qb

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const items: MemberRow[] = (data ?? []).map((r: any) => ({
      user_id: r.user_id,
      email: me.role === 'coach' ? null : r.email ?? null,
      first_name: r.first_name ?? null,
      last_name: r.last_name ?? null,
      phone: me.role === 'coach' ? null : r.phone ?? null,
      role: (r.role ?? null) as Role | null,
      created_at: r.created_at ?? null,
      member_id: r.member_id ?? null,
      date_of_birth: r.date_of_birth ?? null,
    }))

    const ids = items.map((i) => i.user_id).filter(Boolean)

    if (ids.length > 0) {
      const { data: subs, error: subsError } = await admin
        .from('subscriptions')
        .select(
          'member_id, end_date, status, subscription_type, frozen_from, frozen_until, sessions_total, sessions_used'
        )
        .eq('status', 'active')
        .in('member_id', ids)

      if (!subsError) {
        const activeSet = new Set<string>()

        for (const s of subs ?? []) {
          const mid = (s as any)?.member_id as string | null
          if (!mid) continue

          const subscriptionType = (
            (s as any)?.subscription_type ??
            ((s as any)?.end_date ? 'time' : 'sessions')
          ) as 'time' | 'sessions'

          if (subscriptionType === 'time') {
            const endDate = (s as any)?.end_date as string | null
            if (!endDate || endDate < today) continue
            if (isFrozenNow(s as any, today)) continue
            activeSet.add(mid)
            continue
          }

          const total = Number((s as any)?.sessions_total ?? 0)
          const used = Number((s as any)?.sessions_used ?? 0)
          if (Math.max(total - used, 0) > 0) activeSet.add(mid)
        }

        for (const it of items) it.is_active = activeSet.has(it.user_id)
      } else {
        console.error('Error fetching subscriptions (search active flag):', subsError)
        for (const it of items) it.is_active = null
      }
    }

    return NextResponse.json(
      { ok: true, items, page, limit, total: count ?? null },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}