'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
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

export default function MembersPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [meRole, setMeRole] = useState<Role | null>(null)
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
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Members</h1>
        <p>Access denied.</p>
        <div className="mt-4">
          <Link href="/" className="underline">Back to home</Link>
        </div>
      </main>
    )
  }

  return (
    <main className="p-6 space-y-3">
      <h1 className="text-2xl font-bold">Members</h1>

      <div className="flex gap-2 flex-wrap items-center">
        <input
          className="border px-3 py-2"
          placeholder="Search name, email, phone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <select className="border px-3 py-2" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          <option value="member">Member</option>
          <option value="assistant_coach">Assistant Coach</option>
          <option value="coach">Coach</option>
          <option value="reception">Reception</option>
          <option value="admin">Admin</option>
          <option value="super_admin">Super Admin</option>
        </select>

        <button onClick={fetchMembers} className="border px-4 py-2 rounded">
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
