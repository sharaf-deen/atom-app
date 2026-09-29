'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import type { FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Button from '@/components/ui/Button'

type Status = 'all' | 'active' | 'frozen' | 'inactive'
type InactiveReason = 'all' | 'expired' | 'cancelled' | 'no_membership' | 'depleted_legacy' | 'other_inactive'
type ProgramOption = { key: string; name: string; level: string }

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.floor(n)))
}
function normalizeStatus(v: string): Status {
  const s = (v || 'all').toLowerCase()
  return (['all', 'active', 'frozen', 'inactive'] as const).includes(s as any) ? (s as Status) : 'all'
}
function normalizeInactiveReason(v: string): InactiveReason {
  const s = (v || 'all').toLowerCase()
  return (['all', 'expired', 'cancelled', 'no_membership', 'depleted_legacy', 'other_inactive'] as const).includes(s as any)
    ? (s as InactiveReason)
    : 'all'
}

export default function MembersFilters({
  initialQ,
  initialStatus,
  initialInactiveReason,
  initialProgram,
  initialPageSize,
  className,
}: {
  initialQ: string
  initialStatus: Status
  initialInactiveReason: InactiveReason
  initialProgram: string
  initialPageSize: number
  className?: string
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [q, setQ] = useState(initialQ)
  const [status, setStatus] = useState<Status>(initialStatus)
  const [inactiveReason, setInactiveReason] = useState<InactiveReason>(initialInactiveReason)
  const [program, setProgram] = useState(initialProgram)
  const [programs, setPrograms] = useState<ProgramOption[]>([])
  const [pageSize, setPageSize] = useState(clampInt(initialPageSize, 5, 200))

  useEffect(() => {
    let cancelled = false
    async function loadPrograms() {
      try {
        const response = await fetch('/api/member-programs/options', { cache: 'no-store' })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || data?.ok !== true) return
        if (!cancelled) setPrograms(Array.isArray(data.programs) ? data.programs : [])
      } catch {}
    }
    void loadPrograms()
    return () => { cancelled = true }
  }, [])

  const base = useMemo(() => {
    const p = new URLSearchParams(sp?.toString() || '')
    p.delete('q')
    p.delete('status')
    p.delete('reason')
    p.delete('program')
    p.delete('page')
    p.delete('pageSize')
    return p
  }, [sp])

  function apply(next: { q?: string; status?: Status; inactiveReason?: InactiveReason; program?: string; page?: number; pageSize?: number }) {
    const p = new URLSearchParams(base)
    const nextQ = (next.q ?? q).trim()
    const nextStatus = normalizeStatus(String(next.status ?? status))
    const nextReason = normalizeInactiveReason(String(next.inactiveReason ?? inactiveReason))
    const nextProgram = String(next.program ?? program).trim()
    const nextPageSize = clampInt(Number(next.pageSize ?? pageSize), 5, 200)
    const nextPage = clampInt(Number(next.page ?? 1), 1, 1_000_000)

    if (nextQ) p.set('q', nextQ)
    else {
      if (nextStatus !== 'all') p.set('status', nextStatus)
      if (nextStatus === 'inactive' && nextReason !== 'all') p.set('reason', nextReason)
    }
    if (nextProgram) p.set('program', nextProgram)
    if (nextPage > 1) p.set('page', String(nextPage))
    if (nextPageSize !== 20) p.set('pageSize', String(nextPageSize))

    const qs = p.toString()
    startTransition(() => router.push(qs ? `/members?${qs}` : '/members'))
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    apply({ page: 1 })
  }

  function onReset() {
    setQ('')
    setStatus('all')
    setInactiveReason('all')
    setProgram('')
    setPageSize(20)
    startTransition(() => router.push('/members'))
  }

  return (
    <form onSubmit={onSubmit} className={className ?? ''}>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 flex-1 sm:min-w-[260px]">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, phone or member ID…" aria-label="Search members" />
        </div>

        <div className="w-full sm:w-44">
          <Select label="Status" value={status} onChange={(e) => {
            const v = normalizeStatus(e.target.value)
            const nextReason = v === 'inactive' ? inactiveReason : 'all'
            setStatus(v)
            if (v !== 'inactive') setInactiveReason('all')
            setQ('')
            apply({ q: '', status: v, inactiveReason: nextReason, page: 1 })
          }}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="frozen">Frozen</option>
            <option value="inactive">Inactive</option>
          </Select>
        </div>

        {status === 'inactive' ? (
          <div className="w-full sm:w-52">
            <Select label="Inactive reason" value={inactiveReason} onChange={(e) => {
              const v = normalizeInactiveReason(e.target.value)
              setInactiveReason(v)
              setQ('')
              apply({ q: '', status: 'inactive', inactiveReason: v, page: 1 })
            }}>
              <option value="all">All inactive</option>
              <option value="expired">Expired</option>
              <option value="cancelled">Cancelled</option>
              <option value="no_membership">No membership yet</option>
              <option value="depleted_legacy">Depleted legacy</option>
              <option value="other_inactive">Other inactive</option>
            </Select>
          </div>
        ) : null}

        <div className="w-full sm:w-64">
          <Select label="Program" value={program} onChange={(e) => {
            const v = e.target.value
            setProgram(v)
            apply({ program: v, page: 1 })
          }}>
            <option value="">All programs</option>
            <option value="__unassigned__">Program not set</option>
            {programs.map((item) => (
              <option key={item.key} value={item.key}>{item.name}</option>
            ))}
          </Select>
        </div>

        <div className="w-full sm:w-32">
          <Select label="Rows" value={String(pageSize)} onChange={(e) => {
            const v = clampInt(Number(e.target.value), 5, 200)
            setPageSize(v)
            apply({ pageSize: v, page: 1 })
          }}>
            <option value="10">10</option><option value="20">20</option><option value="50">50</option><option value="100">100</option><option value="200">200</option>
          </Select>
        </div>

        <div className="flex gap-2">
          <Button type="submit" disabled={isPending}>{isPending ? 'Loading…' : 'Apply'}</Button>
          <Button type="button" variant="outline" disabled={isPending} onClick={onReset}>Clear</Button>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-[hsl(var(--muted))]">
        Program tracks the member’s current academy group. Athlete progression level remains separate.
      </p>
    </form>
  )
}
