// src/components/MembersMultiPicker.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

type Member = {
  user_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  phone?: string | null
}

export default function MembersMultiPicker({
  onChange,
  initialSelected = [],
  placeholder = 'Search member by name, email, or ID…',
  disabled = false,
}: {
  onChange: (ids: string[]) => void
  initialSelected?: string[]
  placeholder?: string
  disabled?: boolean
}) {
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string>('')
  const [items, setItems] = useState<Member[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected))

  const debTimer = useRef<number | null>(null)
  const query = useMemo(() => q.trim(), [q])

  // notify parent on selection change
  useEffect(() => {
    onChange(Array.from(selected))
  }, [selected, onChange])

  // first load
  useEffect(() => {
    runSearch(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // debounce search
  useEffect(() => {
    if (debTimer.current) window.clearTimeout(debTimer.current)
    debTimer.current = window.setTimeout(() => runSearch(query), 300)
    return () => {
      if (debTimer.current) window.clearTimeout(debTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  async function runSearch(qs: string) {
    if (disabled) return
    setLoading(true)
    setErr('')
    try {
      const url = new URL('/api/members/search', window.location.origin)
      if (qs) url.searchParams.set('q', qs)
      const r = await fetch(url.toString(), { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        setErr(j?.error || 'Failed to load members')
        setItems([])
        return
      }
      setItems(Array.isArray(j.items) ? j.items : [])
    } catch (e: any) {
      setErr(String(e?.message || e))
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllCurrent() {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const it of items) if (it.user_id) next.add(it.user_id)
      return next
    })
  }

  function clearAll() {
    setSelected(new Set())
  }

  function displayName(m: Member) {
    const n = [m.first_name ?? '', m.last_name ?? ''].join(' ').trim()
    return n || m.email || m.user_id
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      runSearch(query)
    }
  }

  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
      {/* Search row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex-1">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            aria-label="Search members"
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            onClick={() => runSearch(query)}
            disabled={disabled || loading}
          >
            {loading ? 'Searching…' : 'Search'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setQ('')
              runSearch('')
            }}
            disabled={disabled || loading}
          >
            Reset
          </Button>
        </div>
      </div>

      {/* Actions & counters */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--muted))]">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={selectAllCurrent}
          disabled={disabled || items.length === 0}
        >
          Select all (page)
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={clearAll}
          disabled={disabled || selected.size === 0}
        >
          Clear
        </Button>
        <span className="sm:ml-auto">
          Selected: <strong>{selected.size}</strong>
        </span>
      </div>

      {/* Error */}
      {err && (
        <div className="mt-2 rounded-2xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      {/* Results list */}
      <div className="mt-3 max-h-64 overflow-auto rounded-2xl border border-[hsl(var(--border))] bg-white">
        {items.length === 0 && !loading ? (
          <div className="p-3 text-sm text-[hsl(var(--muted))]">No results.</div>
        ) : (
          items.map((m, i) => (
            <label
              key={m.user_id}
              className="flex items-center gap-2 px-3 py-2 border-b border-[hsl(var(--border))] last:border-b-0"
            >
              <input
                type="checkbox"
                checked={selected.has(m.user_id)}
                onChange={() => toggle(m.user_id)}
                disabled={disabled}
                aria-label={`Select ${displayName(m)}`}
              />
              <div className="text-sm">
                <div className="font-medium">{displayName(m)}</div>
                <div className="text-xs text-[hsl(var(--muted))]">{m.email}</div>
              </div>
            </label>
          ))
        )}
      </div>
    </div>
  )
}
