'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'
import AccessDeniedCard from '@/components/AccessDeniedCard'

type Role = 'member' | 'assistant_coach' | 'coach' | 'reception' | 'admin' | 'super_admin'

type Member = {
  user_id: string
  email: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  role: Role | null
}

const OPS: Role[] = ['reception', 'admin', 'super_admin']

function safeNext(nextPath: string | null) {
  if (!nextPath) return '/'
  if (nextPath.startsWith('/') && !nextPath.startsWith('//')) return nextPath
  return '/'
}

export default function AdminMembersPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const searchParams = useSearchParams()
  const nextPath = useMemo(() => safeNext(searchParams.get('next')), [searchParams])

  const [meRole, setMeRole] = useState<Role | null>(null)
  const [meEmail, setMeEmail] = useState<string>('')
  const [checking, setChecking] = useState(true)

  const [q, setQ] = useState('')
  const [role, setRole] = useState<string>('')

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const [rows, setRows] = useState<Member[]>([])
  const [total, setTotal] = useState<number>(0)
  const [msg, setMsg] = useState<string>('')

  const canView = meRole ? OPS.includes(meRole) : false

  // Load session + role
  useEffect(() => {
    ;(async () => {
      setChecking(true)

      const { data } = await supabase.auth.getSession()
      const u = data.session?.user

      if (!u?.id) {
        window.location.replace('/login?next=/admin/members')
        return
      }

      setMeEmail(u.email ?? '')

      const { data: prof, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', u.id)
        .maybeSingle()

      if (error) {
        // fallback: treat as member
        setMeRole('member')
      } else {
        setMeRole((prof?.role ?? 'member') as Role)
      }

      setChecking(false)
    })()
  }, [supabase])

  async function fetchMembers(opts?: { resetPage?: boolean }) {
    const targetPage = opts?.resetPage ? 1 : page

    setMsg('Loading…')
    try {
      const res = await fetch('/api/admin/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: q || undefined,
          role: role || undefined,
          page: targetPage,
          pageSize,
        }),
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        setRows([])
        setTotal(0)
        setMsg(`❌ ${json?.error || 'Request failed'}`)
        return
      }

      setRows(json.members ?? [])
      setTotal(Number(json.total ?? 0))
      setMsg('')
      if (opts?.resetPage) setPage(1)
    } catch {
      setRows([])
      setTotal(0)
      setMsg('❌ Network error')
    }
  }

  // Initial fetch after role check
  useEffect(() => {
    if (!checking && canView) {
      fetchMembers({ resetPage: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checking, canView])

  // Refetch on page/pageSize changes
  useEffect(() => {
    if (!checking && canView) fetchMembers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize])

  if (checking) {
    return (
      <main className="p-6">
        <div className="text-sm text-gray-600">Checking session…</div>
      </main>
    )
  }

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
          />
          <div className="mt-3 text-sm text-[hsl(var(--muted))]">
            Signed in as: <span className="font-medium">{meEmail || 'unknown'}</span>
          </div>
        </div>
      </main>
    )
  }

  const totalPages = Math.max(1, Math.ceil((total || 0) / pageSize))

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Admin · Members</h1>
          <p className="text-sm text-[hsl(var(--muted))]">
            Signed in as <span className="font-medium">{meEmail}</span>
          </p>
        </div>

        <div className="flex gap-2">
          <Link href="/admin" className="border px-4 py-2 rounded-lg hover:bg-gray-50">
            ← Admin
          </Link>
          <Link href="/members" className="border px-4 py-2 rounded-lg hover:bg-gray-50">
            Members (public)
          </Link>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <input
          className="border px-3 py-2 rounded-lg"
          placeholder="Search name, email, phone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <select className="border px-3 py-2 rounded-lg" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          <option value="member">Member</option>
          <option value="assistant_coach">Assistant Coach</option>
          <option value="coach">Coach</option>
          <option value="reception">Reception</option>
          <option value="admin">Admin</option>
          <option value="super_admin">Super Admin</option>
        </select>

        <button
          onClick={() => fetchMembers({ resetPage: true })}
          className="border px-4 py-2 rounded-lg hover:bg-gray-50"
        >
          Search
        </button>

        <div className="ml-auto flex gap-2 items-center">
          <span className="text-sm text-[hsl(var(--muted))]">Rows:</span>
          <select
            className="border px-3 py-2 rounded-lg"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
          >
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
        </div>
      </div>

      {msg && <p className="text-sm">{msg}</p>}

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
                <td className="border-b px-3 py-2">
                  {`${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || '—'}
                </td>
                <td className="border-b px-3 py-2">{m.email}</td>
                <td className="border-b px-3 py-2">{m.phone ?? '—'}</td>
                <td className="border-b px-3 py-2 text-center">{m.role ?? 'member'}</td>
                <td className="border-b px-3 py-2">
                  <Link className="underline" href={`/members/${m.user_id}`}>
                    Open
                  </Link>
                </td>
              </tr>
            ))}

            {rows.length === 0 && !msg && (
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
          <button
            className="border px-4 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            onClick={() => setPage(1)}
            disabled={page <= 1}
          >
            First
          </button>
          <button
            className="border px-4 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Prev
          </button>
          <button
            className="border px-4 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next
          </button>
          <button
            className="border px-4 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            onClick={() => setPage(totalPages)}
            disabled={page >= totalPages}
          >
            Last
          </button>
        </div>
      </div>

      {/* Small note */}
      <p className="text-xs text-[hsl(var(--muted))]">
        This page uses <code>/api/admin/members</code> (POST) with your current session.
      </p>
    </main>
  )
}
