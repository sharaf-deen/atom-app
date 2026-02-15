'use client'

import { useMemo, useState, useTransition } from 'react'
import type { FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

type Role = 'member' | 'assistant_coach' | 'coach' | 'reception' | 'admin' | 'super_admin'

function clampInt(v: number, min: number, max: number) {
  if (!Number.isFinite(v)) return min
  return Math.max(min, Math.min(max, Math.floor(v)))
}

function normalizeRole(v: string) {
  const allowed: Role[] = ['member', 'assistant_coach', 'coach', 'reception', 'admin', 'super_admin']
  return (allowed as string[]).includes(v) ? (v as Role) : ''
}

export default function AdminMembersFilters({
  initialQ,
  initialRole,
  initialPageSize,
  className,
}: {
  initialQ: string
  initialRole: string
  initialPageSize: number
  className?: string
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const [q, setQ] = useState(initialQ)
  const [role, setRole] = useState(initialRole)
  const [pageSize, setPageSize] = useState(initialPageSize)

  // Keep base params in case other things add params later.
  const base = useMemo(() => {
    const p = new URLSearchParams(sp?.toString() || '')
    // We'll control these keys.
    p.delete('q')
    p.delete('role')
    p.delete('page')
    p.delete('pageSize')
    return p
  }, [sp])

  function apply(next: { q?: string; role?: string; page?: number; pageSize?: number }) {
    const p = new URLSearchParams(base)
    const nextQ = (next.q ?? q).trim()
    const nextRole = normalizeRole(String(next.role ?? role))
    const nextPageSize = clampInt(Number(next.pageSize ?? pageSize), 5, 50)
    const nextPage = clampInt(Number(next.page ?? 1), 1, 1_000_000)

    if (nextQ) p.set('q', nextQ)
    if (nextRole) p.set('role', nextRole)
    if (nextPage > 1) p.set('page', String(nextPage))
    if (nextPageSize !== 10) p.set('pageSize', String(nextPageSize))

    const qs = p.toString()
    const href = qs ? `/admin/members?${qs}` : '/admin/members'

    startTransition(() => {
      router.push(href)
    })
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    apply({ page: 1 })
  }

  return (
    <form onSubmit={onSubmit} className={className ?? ''}>
      <div className="flex gap-2 flex-wrap items-center">
        <input
          className="border px-3 py-2 rounded-lg"
          placeholder="Search name, email, phone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <select
          className="border px-3 py-2 rounded-lg"
          value={role}
          onChange={(e) => {
            const v = e.target.value
            setRole(v)
            // Reset to page 1 when changing filters.
            apply({ role: v, page: 1 })
          }}
        >
          <option value="">All roles</option>
          <option value="member">Member</option>
          <option value="assistant_coach">Assistant Coach</option>
          <option value="coach">Coach</option>
          <option value="reception">Reception</option>
          <option value="admin">Admin</option>
          <option value="super_admin">Super Admin</option>
        </select>

        <button
          type="submit"
          disabled={isPending}
          className="border px-4 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-60"
        >
          {isPending ? 'Loading…' : 'Search'}
        </button>

        <div className="ml-auto flex gap-2 items-center">
          <span className="text-sm text-[hsl(var(--muted))]">Rows:</span>
          <select
            className="border px-3 py-2 rounded-lg"
            value={pageSize}
            onChange={(e) => {
              const v = clampInt(Number(e.target.value), 5, 50)
              setPageSize(v)
              apply({ pageSize: v, page: 1 })
            }}
          >
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
        </div>
      </div>
    </form>
  )
}
