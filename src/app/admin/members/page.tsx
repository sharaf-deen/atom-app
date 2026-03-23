// src/app/admin/members/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import { getSessionUser, type Role } from '@/lib/session'
import { getSupabaseAdminClientCached } from '@/lib/requestCache'
import AdminMembersFilters from './_components/AdminMembersFilters'
import AdminRoleEditor from './_components/AdminRoleEditor'

type Member = {
  user_id: string
  member_id: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  role: Role | null
  created_at: string | null
}

type RoleOption = { id: Role; label: string }

const FALLBACK_ROLE_OPTIONS: RoleOption[] = [
  { id: 'member', label: 'Member' },
  { id: 'champion', label: 'Champion' },
  { id: 'vip', label: 'VIP' },
  { id: 'assistant_coach', label: 'Assistant Coach' },
  { id: 'coach', label: 'Coach' },
  { id: 'head_coach', label: 'Head Coach' },
  { id: 'reception', label: 'Reception' },
  { id: 'admin', label: 'Admin' },
  { id: 'super_admin', label: 'Super Admin' },
]

const OPS: Role[] = ['reception', 'admin', 'super_admin']

function clampInt(v: number, min: number, max: number) {
  if (!Number.isFinite(v)) return min
  return Math.max(min, Math.min(max, Math.floor(v)))
}

function normalizeRole(v: unknown): Role | null {
  const s = typeof v === 'string' ? v : ''
  const allowed: Role[] = ['member', 'champion', 'vip', 'assistant_coach', 'coach', 'head_coach', 'reception', 'admin', 'super_admin']
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
  const canEdit = me.role === 'super_admin'

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
  // Use the shared cached admin client for consistency.
  let admin: ReturnType<typeof getSupabaseAdminClientCached>
  try {
    admin = getSupabaseAdminClientCached()
  } catch {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Admin · Members</h1>
        <p className="mt-3 text-sm text-rose-700">Server env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY</p>
      </main>
    )
  }

  // Load role labels (from public.roles) for nicer UI + validation.
  let roleOptions: RoleOption[] = FALLBACK_ROLE_OPTIONS
  try {
    const { data: rdata, error: rerr } = await admin.from('roles').select('id,label').order('label', { ascending: true })
    if (!rerr && Array.isArray(rdata)) {
      const opts: RoleOption[] = []
      for (const r of rdata as any[]) {
        const id = normalizeRole((r as any)?.id)
        const label = String((r as any)?.label ?? '').trim()
        if (id) opts.push({ id, label: label || id })
      }
      if (opts.length) roleOptions = opts
    }
  } catch {
    // ignore
  }

  const labelForRole = (r?: Role | null) => {
    const id = (r ?? 'member') as Role
    return roleOptions.find((x) => x.id === id)?.label ?? id
  }

  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = admin
    .from('profiles')
    .select('user_id,member_id,email,first_name,last_name,phone,role,created_at', { count: 'exact' })
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

      {/* Results (mobile-first, no horizontal scroll) */}
      <div className="space-y-3">
        {/* Cards (mobile / tablet) */}
        <div className="space-y-3 lg:hidden">
          {rows.map((m) => {
            const name = `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || '—'
            return (
              <div
                key={m.user_id}
                className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-[15px] leading-5 truncate">{name}</div>
                    <div className="mt-1 text-[12px] text-[hsl(var(--muted))]">
                      ID: <code className="text-[11px]">{m.member_id?.trim() || '—'}</code>
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <span className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2 py-0.5 text-[11px] font-semibold">
                      {labelForRole(m.role)}
                    </span>
                  </div>
                </div>

                <div className="mt-3 space-y-1 text-[13px]">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[11px] font-medium text-[hsl(var(--muted))]">Email</span>
                    <span className="min-w-0 text-right font-medium break-words whitespace-normal">{m.email ?? '—'}</span>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[11px] font-medium text-[hsl(var(--muted))]">Phone</span>
                    <span className="min-w-0 text-right font-medium break-words whitespace-normal">{m.phone ?? '—'}</span>
                  </div>
                </div>

                <div className={`mt-3 flex items-center gap-2 border-t border-[hsl(var(--border))] pt-3 ${canEdit ? 'justify-between' : 'justify-end'}`}>
                  {canEdit ? (
                    <AdminRoleEditor userId={m.user_id} currentRole={(m.role ?? 'member') as Role} options={roleOptions} compact />
                  ) : null}
                  <Link
                    prefetch={false}
                    className="inline-flex items-center rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm font-semibold hover:bg-[hsl(var(--bg))]"
                    href={`/members/${m.user_id}`}
                  >
                    Open
                  </Link>
                </div>
              </div>
            )
          })}

          {rows.length === 0 && !error && (
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 text-center text-sm text-[hsl(var(--muted))] shadow-soft">
              No members found
            </div>
          )}
        </div>

        {/* Table (desktop) */}
        <div className="hidden lg:block rounded-2xl border border-[hsl(var(--border))] overflow-hidden bg-[hsl(var(--card))] shadow-soft">
          <table className="w-full text-sm">
            <thead className="bg-[hsl(var(--bg))] text-left text-[hsl(var(--muted))]">
              <tr>
                <th className="border-b border-[hsl(var(--border))] px-4 py-3 font-medium">Name</th>
                <th className="border-b border-[hsl(var(--border))] px-4 py-3 font-medium">Member&nbsp;ID</th>
                <th className="border-b border-[hsl(var(--border))] px-4 py-3 font-medium">Email</th>
                <th className="border-b border-[hsl(var(--border))] px-4 py-3 font-medium">Phone</th>
                <th className="border-b border-[hsl(var(--border))] px-4 py-3 font-medium text-center">Role</th>
                <th className="border-b border-[hsl(var(--border))] px-4 py-3 font-medium">Profile</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.user_id} className="odd:bg-[hsl(var(--card))] even:bg-[hsl(var(--bg))]">
                  <td className="border-t border-[hsl(var(--border))] px-4 py-3">
                    {`${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || '—'}
                  </td>
                  <td className="border-t border-[hsl(var(--border))] px-4 py-3">
                    <code className="text-xs">{m.member_id?.trim() || '—'}</code>
                  </td>
                  <td className="border-t border-[hsl(var(--border))] px-4 py-3">{m.email ?? '—'}</td>
                  <td className="border-t border-[hsl(var(--border))] px-4 py-3">{m.phone ?? '—'}</td>
                  <td className="border-t border-[hsl(var(--border))] px-4 py-3 text-center">
                    {canEdit ? (
                      <div className="inline-flex justify-center">
                        <AdminRoleEditor userId={m.user_id} currentRole={(m.role ?? 'member') as Role} options={roleOptions} compact />
                      </div>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2 py-0.5 text-[11px] font-semibold">
                        {labelForRole(m.role)}
                      </span>
                    )}
                  </td>
                  <td className="border-t border-[hsl(var(--border))] px-4 py-3">
                    <Link prefetch={false} className="underline" href={`/members/${m.user_id}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}

              {rows.length === 0 && !error && (
                <tr>
                  <td className="px-4 py-8 text-center text-[hsl(var(--muted))]" colSpan={6}>
                    No members found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
