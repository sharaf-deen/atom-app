// src/app/admin/members/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import { getSessionUser, type Role } from '@/lib/session'
import AdminMembersFilters from './_components/AdminMembersFilters'

type Member = {
  user_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  role: Role | null
}

const OPS: Role[] = ['reception', 'admin', 'super_admin']

function clampInt(v: number, min: number, max: number) {
  if (!Number.isFinite(v)) return min
  return Math.max(min, Math.min(max, Math.floor(v)))
}

function normalizeRole(v: unknown): Role | null {
  const s = typeof v === 'string' ? v : ''
  const allowed: Role[] = ['member', 'assistant_coach', 'coach', 'reception', 'admin', 'super_admin']
  return (allowed as string[]).includes(s) ? (s as Role) : null
}

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  const me = await getSessionUser()

  // Build current path for the login redirect.
  const current = new URLSearchParams()
  const q = typeof searchParams?.q === 'string' ? searchParams?.q.trim() : ''
  const role = normalizeRole(typeof searchParams?.role === 'string' ? searchParams?.role : null)
  const page = clampInt(Number(typeof searchParams?.page === 'string' ? searchParams?.page : 1), 1, 1_000_000)
  const pageSize = clampInt(
    Number(typeof searchParams?.pageSize === 'string' ? searchParams?.pageSize : 10),
    5,
    50
  )

  if (q) current.set('q', q)
  if (role) current.set('role', role)
  if (page > 1) current.set('page', String(page))
  if (pageSize !== 10) current.set('pageSize', String(pageSize))

  const currentPath = `/admin/members${current.toString() ? `?${current.toString()}` : ''}`

  if (!me) redirect(`/login?next=${encodeURIComponent(currentPath)}`)

  const canView = OPS.includes(me.role)

  if (!canView) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Admin · Members</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Reception / Admin / Super Admin can access this page."
            nextPath="/admin/members"
            showBackHome
            signedInAs={me.email}
          />
        </div>
      </main>
    )
  }

  // Server-side query (service role) to keep this page server-first.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !service) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Admin · Members</h1>
        <p className="mt-3 text-sm text-rose-700">
          Server env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
        </p>
      </main>
    )
  }

  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = admin
    .from('profiles')
    .select('user_id,email,first_name,last_name,phone,role', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (role) query = query.eq('role', role)

  if (q) {
    const like = `%${q}%`
    query = query.or(
      `email.ilike.${like},first_name.ilike.${like},last_name.ilike.${like},phone.ilike.${like}`
    )
  }

  const { data, error, count } = await query

  const rows: Member[] = (data ?? []) as any
  const total = Number(count ?? 0)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const base = new URLSearchParams()
  if (q) base.set('q', q)
  if (role) base.set('role', role)
  if (pageSize !== 10) base.set('pageSize', String(pageSize))

  const hrefForPage = (p: number) => {
    const sp = new URLSearchParams(base)
    if (p > 1) sp.set('page', String(p))
    const s = sp.toString()
    return s ? `/admin/members?${s}` : '/admin/members'
  }

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Admin · Members</h1>
          <p className="text-sm text-[hsl(var(--muted))]">
            Signed in as <span className="font-medium">{me.email || 'unknown'}</span>
          </p>
        </div>

        <div className="flex gap-2">
          <Link prefetch={false} href="/admin" className="border px-4 py-2 rounded-lg hover:bg-gray-50">
            ← Admin
          </Link>
          <Link prefetch={false} href="/members" className="border px-4 py-2 rounded-lg hover:bg-gray-50">
            Members (public)
          </Link>
        </div>
      </div>

      <AdminMembersFilters initialQ={q} initialRole={role ?? ''} initialPageSize={pageSize} />

      {error && (
        <p className="text-sm text-rose-700">❌ {error.message || 'Failed to load members'}</p>
      )}

      <div className="overflow-auto border rounded-xl">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="border-b px-3 py-2 text-left">Name</th>
              <th className="border-b px-3 py-2 text-left">Email</th>
              <th className="border-b px-3 py-2 text-left">Phone</th>
              <th className="border-b px-3 py-2 text-center">Role</th>
              <th className="border-b px-3 py-2 text-left">Profile</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.user_id} className="hover:bg-gray-50">
                <td className="border-b px-3 py-2">{`${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || '—'}</td>
                <td className="border-b px-3 py-2">{m.email ?? '—'}</td>
                <td className="border-b px-3 py-2">{m.phone ?? '—'}</td>
                <td className="border-b px-3 py-2 text-center">{m.role ?? 'member'}</td>
                <td className="border-b px-3 py-2">
                  <Link prefetch={false} className="underline" href={`/members/${m.user_id}`}>
                    Open
                  </Link>
                </td>
              </tr>
            ))}

            {rows.length === 0 && !error && (
              <tr>
                <td className="px-3 py-6 text-center text-gray-500" colSpan={5}>
                  No members found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-[hsl(var(--muted))]">
          Total: <span className="font-medium">{total}</span> · Page{' '}
          <span className="font-medium">
            {page}/{totalPages}
          </span>
        </div>

        <div className="flex gap-2">
          <Link
            prefetch={false}
            className={`border px-4 py-2 rounded-lg hover:bg-gray-50 ${page <= 1 ? 'pointer-events-none opacity-50' : ''}`}
            href={hrefForPage(1)}
            aria-disabled={page <= 1}
          >
            First
          </Link>
          <Link
            prefetch={false}
            className={`border px-4 py-2 rounded-lg hover:bg-gray-50 ${page <= 1 ? 'pointer-events-none opacity-50' : ''}`}
            href={hrefForPage(Math.max(1, page - 1))}
            aria-disabled={page <= 1}
          >
            Prev
          </Link>
          <Link
            prefetch={false}
            className={`border px-4 py-2 rounded-lg hover:bg-gray-50 ${page >= totalPages ? 'pointer-events-none opacity-50' : ''}`}
            href={hrefForPage(Math.min(totalPages, page + 1))}
            aria-disabled={page >= totalPages}
          >
            Next
          </Link>
          <Link
            prefetch={false}
            className={`border px-4 py-2 rounded-lg hover:bg-gray-50 ${page >= totalPages ? 'pointer-events-none opacity-50' : ''}`}
            href={hrefForPage(totalPages)}
            aria-disabled={page >= totalPages}
          >
            Last
          </Link>
        </div>
      </div>

      <p className="text-xs text-[hsl(var(--muted))]">
        Server-first page. Only the filter bar is client-side.
      </p>
    </main>
  )
}
