'use client'

import { useMemo, useState, useTransition } from 'react'
import type { FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'

type Role = 'member' | 'champion' | 'vip' | 'assistant_coach' | 'coach' | 'head_coach' | 'reception' | 'admin' | 'super_admin'

function clampInt(v: number, min: number, max: number) {
  if (!Number.isFinite(v)) return min
  return Math.max(min, Math.min(max, Math.floor(v)))
}

function normalizeRole(v: string) {
  const allowed: Role[] = ['member', 'champion', 'vip', 'assistant_coach', 'coach', 'head_coach', 'reception', 'admin', 'super_admin']
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

  const hasFilters = Boolean(q.trim() || role || pageSize !== 10)

  return (
    <form onSubmit={onSubmit} className={className ?? ''}>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_220px_120px_auto_auto] xl:items-end">
        <Input
          type="search"
          label="Search member"
          placeholder="Name, email, phone, or ATOM ID"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="w-full"
        />

        <Select
          label="Role"
          value={role}
          onChange={(e) => {
            const v = e.target.value
            setRole(v)
            apply({ role: v, page: 1 })
          }}
        >
          <option value="">All roles</option>
          <option value="member">Member</option>
          <option value="champion">Champion</option>
          <option value="vip">VIP</option>
          <option value="assistant_coach">Assistant Coach</option>
          <option value="coach">Coach</option>
          <option value="head_coach">Head Coach</option>
          <option value="reception">Reception</option>
          <option value="admin">Admin</option>
          <option value="super_admin">Super Admin</option>
        </Select>

        <Select
          label="Rows"
          value={String(pageSize)}
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
        </Select>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
          <Button type="submit" loading={isPending} loadingText="Loading…" className="w-full">
            Search
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={!hasFilters || isPending}
            onClick={() => {
              setQ('')
              setRole('')
              setPageSize(10)
              apply({ q: '', role: '', page: 1, pageSize: 10 })
            }}
          >
            Reset
          </Button>
        </div>
      </div>
    </form>
  )
}
