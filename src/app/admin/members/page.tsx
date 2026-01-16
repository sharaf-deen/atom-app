'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'

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

function sanitizeNext(next: string | null) {
  if (!next) return '/'
  const n = next.trim()
  if (!n.startsWith('/')) return '/'
  if (n.startsWith('//')) return '/'
  if (n.includes('://')) return '/'
  if (n.includes('\\')) return '/'
  return n || '/'
}

export default function MembersPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const searchParams = useSearchParams()
  const nextAfterLogout = useMemo(() => sanitizeNext(searchParams.get('next')), [searchParams])

  const [meRole, setMeRole] = useState<Role | null>(null)
  const [meEmail, setMeEmail] = useState<string>('')
  const [loadingMe, setLoadingMe] = useState(true)

  const [q, setQ] = useState('')
  const [role, setRole] = useState<string>('')
  const [rows, setRows] = useState<Member[]>([])
  const [msg, setMsg] = useState('')

  const canView = meRole ? OPS.includes(meRole) : false

  useEffect(() => {
    ;(async () => {
      setLoadingMe(true)
      const { data } = await supabase.auth.getSession()
      const u = data.session?.user

      if (!u?.id) {
        window.location.replace('/login?next=/admin/members')
        return
      }

      setMeEmail(u.email ?? '')

      const { data: prof } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', u.id)
        .maybeSingle()

      setMeRole((prof?.role ?? 'member') as Role)
      setLoadingMe(false)
    })()
  }, [supabase])

  const fetchMembers = async () => {
    setMsg('Loading...')
    try {
      const res = await fetch('/api/admin/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, role: role || undefined, limit: 100 }),
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        setRows([])
        setMsg(`❌ ${json?.error || 'Request failed'}`)
        return
      }

      setRows(json.members ?? [])
      setMsg('')
    } catch {
      setMsg('❌ Network error')
    }
  }

  useEffect(() => {
    if (!loadingMe && canView) fetchMembers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingMe, canView])

  if (loadingMe) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Members</h1>
        <p className="text-sm text-gray-600">Loading…</p>
      </main>
    )
  }

  if (!canView) {
    const logoutNext = nextAfterLogout || '/admin/members'
    return (
      <main className="p-6 max-w-2xl">
        <h1 className="text-2xl font-bold">Members</h1>

        <div className="mt-4 rounded-2xl border bg-white p-5 space-y-2">
          <div className="text-sm text-gray-600">
            You’re signed in as <span className="font-medium">{meEmail || 'unknown'}</span>.
          </div>

          <div className="text-base font-semibold">Access restricted</div>

          <div className="text-sm text-gray-600">
            This page is limited to <span className="font-medium">Reception</span> and{' '}
            <span className="font-medium">Admins</span>.
            <br />
            If you need access, please contact an administrator.
          </div>

          <div className="flex gap-2 flex-wrap pt-2">
            <Link href="/" className="border rounded-lg px-4 py-2 text-sm hover:bg-gray-50">
              Back to home
            </Link>
            <Link href="/profile" className="border rounded-lg px-4 py-2 text-sm hover:bg-gray-50">
              My profile
            </Link>
            <Link
              href={`/logout?next=${encodeURIComponent(logoutNext)}`}
              className="border rounded-lg px-4 py-2 text-sm hover:bg-gray-50"
            >
              Switch account
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="p-6 space-y-3">
      <h1 className="text-2xl font-bold">Members</h1>

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

        <button onClick={fetchMembers} className="border px-4 py-2 rounded-lg hover:bg-gray-50">
          Search
        </button>

        <Link href="/admin" className="underline ml-auto">
          ← Admin
        </Link>
      </div>

      {msg && <p>{msg}</p>}

      <div className="overflow-auto">
        <table className="min-w-full text-sm border">
          <thead className="bg-gray-50">
            <tr>
              <th className="border px-2 py-1 text-left">Name</th>
              <th className="border px-2 py-1 text-left">Email</th>
              <th className="border px-2 py-1 text-left">Phone</th>
              <th className="border px-2 py-1">Role</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.user_id}>
                <td className="border px-2 py-1">
                  {(m.first_name ?? '') + ' ' + (m.last_name ?? '')}
                </td>
                <td className="border px-2 py-1">{m.email}</td>
                <td className="border px-2 py-1">{m.phone ?? ''}</td>
                <td className="border px-2 py-1 text-center">{m.role ?? 'member'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-4 text-center text-gray-500" colSpan={4}>
                  No members found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  )
}
