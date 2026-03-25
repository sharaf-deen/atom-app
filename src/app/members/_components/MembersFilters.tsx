'use client'

import { useMemo, useState, useTransition } from 'react'
import type { FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Button from '@/components/ui/Button'

type Status = 'all' | 'active' | 'inactive'

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function normalizeStatus(v: string): Status {
  const s = (v || 'all').toLowerCase()
  return (['all', 'active', 'inactive'] as const).includes(s as any) ? (s as Status) : 'all'
}

export default function MembersFilters({
  initialQ,
  initialStatus,
  initialPageSize,
  className,
}: {
  initialQ: string
  initialStatus: Status
  initialPageSize: number
  className?: string
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const [q, setQ] = useState(initialQ)
  const [status, setStatus] = useState<Status>(initialStatus)
  const [pageSize, setPageSize] = useState(clampInt(initialPageSize, 5, 200))

  // Keep base params in case other things add params later.
  const base = useMemo(() => {
    const p = new URLSearchParams(sp?.toString() || '')
    p.delete('q')
    p.delete('status')
    p.delete('page')
    p.delete('pageSize')
    return p
  }, [sp])

  function apply(next: { q?: string; status?: Status; page?: number; pageSize?: number }) {
    const p = new URLSearchParams(base)
    const nextQ = (next.q ?? q).trim()
    const nextStatus = normalizeStatus(String(next.status ?? status))
    const nextPageSize = clampInt(Number(next.pageSize ?? pageSize), 5, 200)
    const nextPage = clampInt(Number(next.page ?? 1), 1, 1_000_000)

    // If q is set, the page runs in SEARCH mode (status ignored).
    if (nextQ) {
      p.set('q', nextQ)
    } else {
      if (nextStatus !== 'all') p.set('status', nextStatus)
    }

    if (nextPage > 1) p.set('page', String(nextPage))
    if (nextPageSize !== 20) p.set('pageSize', String(nextPageSize))

    const qs = p.toString()
    const href = qs ? `/members?${qs}` : '/members'
    startTransition(() => router.push(href))
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    apply({ page: 1 })
  }

  function onReset() {
    setQ('')
    setStatus('all')
    setPageSize(20)
    startTransition(() => router.push('/members'))
  }

  return (
    <form onSubmit={onSubmit} className={className ?? ''}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email, phone or member ID…"
            aria-label="Search members"
          />
        </div>

        <div className="w-full sm:w-48">
          <Select
            label="Status"
            value={status}
            onChange={(e) => {
              const v = normalizeStatus(e.target.value)
              setStatus(v)
              // Switching list type should exit search mode
              setQ('')
              apply({ q: '', status: v, page: 1 })
            }}
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </div>

        <div className="w-full sm:w-40">
          <Select
            label="Rows"
            value={String(pageSize)}
            onChange={(e) => {
              const v = clampInt(Number(e.target.value), 5, 200)
              setPageSize(v)
              apply({ pageSize: v, page: 1 })
            }}
          >
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="200">200</option>
          </Select>
        </div>

        <div className="flex gap-2">
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Loading…' : 'Apply'}
          </Button>
          <Button type="button" variant="outline" disabled={isPending} onClick={onReset}>
            Clear
          </Button>
        </div>
      </div>

      <p className="mt-2 text-[11px] text-[hsl(var(--muted))]">
        Search ignores status.
      </p>
    </form>
  )
}
