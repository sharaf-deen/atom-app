// src/app/admin/outstanding-dues/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import { getSessionUser } from '@/lib/session'
import OutstandingDuesClient from './_components/OutstandingDuesClient'
import RunOutstandingRemindersButton from './_components/RunOutstandingRemindersButton'
import type { OutstandingDueRow } from './types'

type Role = 'member' | 'assistant_coach' | 'coach' | 'reception' | 'admin' | 'super_admin'
const OPS: Role[] = ['admin', 'super_admin']

type SubRow = {
  id: string
  member_id: string | null
  plan: string | null
  status: string | null
  start_date: string | null
  end_date: string | null
  paid_at: string | null
  amount: number | null
  amount_due: number | null
  payment_method: string | null
  created_at: string | null
}

type ProfileRow = {
  user_id: string
  member_id: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
}

export default async function AdminOutstandingDuesPage() {
  const me = await getSessionUser()
  if (!me) redirect('/login?next=/admin/outstanding-dues')

  const allowed = OPS.includes(me.role as Role)
  if (!allowed) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Admin · Outstanding Dues</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Admin / Super Admin can access this page."
            nextPath="/admin/outstanding-dues"
            showBackHome
            signedInAs={me.email}
          />
        </div>
      </main>
    )
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !service) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Admin · Outstanding Dues</h1>
        <p className="mt-3 text-sm text-rose-700">
          Server env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
        </p>
      </main>
    )
  }

  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: subsRaw, error: subsErr } = await admin
    .from('subscriptions')
    .select('id, member_id, plan, status, start_date, end_date, paid_at, amount, amount_due, payment_method, created_at')
    .gt('amount_due', 0)
    .order('amount_due', { ascending: false })
    .limit(5000)

  if (subsErr) {
    return (
      <main className="p-6 space-y-3">
        <h1 className="text-2xl font-bold">Admin · Outstanding Dues</h1>
        <p className="text-sm text-rose-700">❌ {subsErr.message || 'Failed to load subscriptions'}</p>
        <Link className="underline" href="/admin">
          ← Back to Admin
        </Link>
      </main>
    )
  }

  const subs: SubRow[] = (subsRaw ?? []) as any

  const memberIds = Array.from(
    new Set(
      subs
        .map((s) => s.member_id)
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
    )
  )

  const profileMap = new Map<string, ProfileRow>()
  if (memberIds.length) {
    const { data: profiles } = await admin
      .from('profiles')
      .select('user_id, member_id, email, first_name, last_name, phone')
      .in('user_id', memberIds)

    for (const p of ((profiles ?? []) as any[]) as ProfileRow[]) {
      if (p?.user_id) profileMap.set(p.user_id, p)
    }
  }

  const rows: OutstandingDueRow[] = subs
    .filter((s) => !!s.member_id)
    .map((s) => {
      const uid = s.member_id as string
      const p = profileMap.get(uid)
      const name = `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim() || '—'
      const paid = Number(s.amount ?? 0)
      const due = Number(s.amount_due ?? 0)
      return {
        subscription_id: s.id,
        user_id: uid,
        member_code: p?.member_id ?? null,
        name,
        email: p?.email ?? null,
        phone: p?.phone ?? null,
        plan: s.plan ?? null,
        status: s.status ?? null,
        paid_at: s.paid_at ?? null,
        paid,
        due,
        total: paid + due,
        payment_method: s.payment_method ?? null,
      }
    })

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Admin · Outstanding Dues</h1>
          <p className="text-sm text-[hsl(var(--muted))]">
            Signed in as <span className="font-medium">{me.email || 'unknown'}</span>
          </p>
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          <RunOutstandingRemindersButton />
          <Link prefetch={false} href="/admin" className="border px-4 py-2 rounded-lg hover:bg-gray-50">
            ← Admin
          </Link>
          <Link prefetch={false} href="/members" className="border px-4 py-2 rounded-lg hover:bg-gray-50">
            Members
          </Link>
        </div>
      </div>

      <OutstandingDuesClient initialRows={rows} />
    </main>
  )
}
