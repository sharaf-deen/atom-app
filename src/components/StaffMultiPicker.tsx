// src/components/StaffMultiPicker.tsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type StaffItem = {
  user_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  role: 'assistant_coach' | 'coach'
}

export default function StaffMultiPicker({
  onChange,
  defaultSelected = [],
}: {
  onChange: (userIds: string[]) => void
  defaultSelected?: string[]
}) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<StaffItem[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string>('')
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultSelected))

  // fetch avec debounce
  useEffect(() => {
    let alive = true
    const timer = setTimeout(async () => {
      setLoading(true)
      setErr('')
      try {
        const params = new URLSearchParams()
        if (q.trim()) params.set('q', q.trim())
        params.set('limit', '200')
        const r = await fetch(`/api/staff/list?${params.toString()}`, { cache: 'no-store' })
        const j = await r.json()
        if (!alive) return
        if (!r.ok || !j?.ok) {
          setErr(j?.details || j?.error || 'Failed to load staff')
          setItems([])
        } else {
          setItems(j.items || [])
        }
      } catch (e: any) {
        if (!alive) return
        setErr(String(e?.message || e))
        setItems([])
      } finally {
        if (alive) setLoading(false)
      }
    }, 300)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [q])

  useEffect(() => {
    onChange(Array.from(selected))
  }, [selected, onChange])

  const allChecked = useMemo(() => {
    if (items.length === 0) return false
    return items.every((i) => selected.has(i.user_id))
  }, [items, selected])

  const toggleOne = useCallback((id: string) => {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }, [])

  const toggleAllOnPage = useCallback(() => {
    setSelected((s) => {
      const n = new Set(s)
      const allSelected = items.every((i) => n.has(i.user_id))
      if (allSelected) {
        // unselect all on page
        for (const i of items) n.delete(i.user_id)
      } else {
        // select all on page
        for (const i of items) n.add(i.user_id)
      }
      return n
    })
  }, [items])

  const clearAll = useCallback(() => setSelected(new Set()), [])

  function labelOf(i: StaffItem) {
    const name = `${i.first_name ?? ''} ${i.last_name ?? ''}`.trim()
    return name || (i.email ?? i.user_id)
  }

  return (
    <div className="rounded-lg border bg-gray-50 p-3">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search staff by name or email…"
          className="px-3 py-2 border rounded w-full sm:max-w-sm"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleAllOnPage}
            className="px-2 py-1 rounded border hover:bg-white"
          >
            {allChecked ? 'Unselect page' : 'Select page'}
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="px-2 py-1 rounded border hover:bg-white"
          >
            Clear all
          </button>
        </div>
        <div className="sm:ml-auto text-xs text-gray-600">
          Selected: {selected.size}
        </div>
      </div>

      {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
      {loading && <div className="mt-2 text-xs text-gray-500">Loading…</div>}

      <div className="mt-3 max-h-64 overflow-auto rounded border bg-white">
        {items.length === 0 ? (
          <div className="p-3 text-sm text-gray-500">No results.</div>
        ) : (
          <ul className="divide-y">
            {items.map((i) => (
              <li key={i.user_id} className="flex items-center gap-2 p-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={selected.has(i.user_id)}
                    onChange={() => toggleOne(i.user_id)}
                  />
                  <span className="text-sm">
                    <span className="font-medium">{labelOf(i)}</span>{' '}
                    <span className="text-gray-500">
                      {i.email ? `· ${i.email}` : ''}
                    </span>
                    <span className="ml-2 text-xs rounded px-1.5 py-0.5 border">
                      {i.role === 'coach' ? 'Coach' : 'Assistant coach'}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
