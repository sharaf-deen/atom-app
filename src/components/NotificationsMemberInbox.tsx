// src/components/NotificationsMemberInbox.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'

type Row = {
  id: string
  title: string | null
  body: string
  kind: string | null
  created_at: string
  read_at: string | null
  created_by: string | null
}

const PER_PAGE = 5

export default function NotificationsMemberInbox() {
  const [items, setItems] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string>('')

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Pagination
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PER_PAGE)), [total])

  const pageIds = useMemo(() => items.map((x) => x.id), [items])
  const allSelected = useMemo(() => {
    if (pageIds.length === 0) return false
    for (const id of pageIds) if (!selected.has(id)) return false
    return true
  }, [pageIds, selected])

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        // unselect all on page
        for (const id of pageIds) next.delete(id)
      } else {
        // select all on page
        for (const id of pageIds) next.add(id)
      }
      return next
    })
  }

  async function load(p = page) {
    setLoading(true)
    setMsg('')
    try {
      const params = new URLSearchParams()
      params.set('kind', 'member_contact')
      params.set('page', String(p))
      params.set('limit', String(PER_PAGE))

      const r = await fetch(`/api/notifications/list?${params.toString()}`, { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        setMsg(j?.details || j?.error || 'Failed to load inbox')
        setItems([])
        setTotal(0)
        setSelected(new Set())
        return
      }
      setItems(Array.isArray(j.items) ? j.items : [])
      setTotal(Number(j.total || 0))
      setPage(Number(j.page || p))
      setSelected(new Set())
    } catch (e: any) {
      setMsg(String(e?.message || e))
      setItems([])
      setTotal(0)
      setSelected(new Set())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Listen to global reload signals (top Reload button / notification updates)
  useEffect(() => {
    const handler = () => load(page)
    window.addEventListener('atom:reload', handler)
    window.addEventListener('notifications:updated', handler)
    return () => {
      window.removeEventListener('atom:reload', handler)
      window.removeEventListener('notifications:updated', handler)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  async function markSelectedRead() {
    const ids = Array.from(selected)
    if (ids.length === 0) return

    setMsg('')
    try {
      const r = await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        setMsg(j?.details || j?.error || 'Failed to mark as read')
        return
      }
      setMsg(`Marked ${ids.length} as read.`)
      window.dispatchEvent(new Event('notifications:updated'))
      await load(page)
    } catch (e: any) {
      setMsg(String(e?.message || e))
    }
  }

  async function markSelectedUnread() {
    const ids = Array.from(selected)
    if (ids.length === 0) return

    setMsg('')
    try {
      const r = await fetch('/api/notifications/mark-unread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        setMsg(j?.details || j?.error || 'Failed to mark as unread')
        return
      }
      setMsg(`Marked ${ids.length} as unread.`)
      window.dispatchEvent(new Event('notifications:updated'))
      await load(page)
    } catch (e: any) {
      setMsg(String(e?.message || e))
    }
  }

  async function markAllReadOnPage() {
    const unreadIds = items.filter((x) => !x.read_at).map((x) => x.id)
    if (unreadIds.length === 0) return

    setMsg('')
    try {
      const r = await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: unreadIds }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        setMsg(j?.details || j?.error || 'Failed to mark as read')
        return
      }
      setMsg(`Marked ${unreadIds.length} as read.`)
      window.dispatchEvent(new Event('notifications:updated'))
      await load(page)
    } catch (e: any) {
      setMsg(String(e?.message || e))
    }
  }

  function fmtDate(iso: string) {
    try {
      const d = new Date(iso)
      return d.toLocaleString()
    } catch {
      return iso
    }
  }

  return (
    <Card hover>
      <CardHeader className="items-start">
        <CardTitle>Member messages</CardTitle>
      </CardHeader>

      <CardContent>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={toggleAllOnPage}
            disabled={loading || items.length === 0}
            title="Select/unselect all messages on this page"
          >
            {allSelected ? 'Unselect all (page)' : 'Select all (page)'}
          </Button>

          <Button
            variant="outline"
            onClick={markSelectedRead}
            disabled={loading || selected.size === 0}
            title="Mark selected messages as read"
          >
            Mark selected read
          </Button>

          <Button
            variant="outline"
            onClick={markSelectedUnread}
            disabled={loading || selected.size === 0}
            title="Mark selected messages as unread"
          >
            Mark selected unread
          </Button>

          <Button
            variant="outline"
            onClick={markAllReadOnPage}
            disabled={loading || items.every((i) => !!i.read_at)}
            title="Mark unread items on this page as read"
          >
            Mark all read (page)
          </Button>

          {loading && <span className="text-xs text-[hsl(var(--muted))] ml-1">Loading…</span>}
          {msg && <span className="text-xs text-[hsl(var(--muted))] ml-1">{msg}</span>}
        </div>

        <div className="mt-4 grid gap-3">
          {items.length === 0 ? (
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 text-[hsl(var(--muted))]">
              No member messages.
            </div>
          ) : (
            items.map((n) => {
              const isSel = selected.has(n.id)
              return (
                <div
                  key={n.id}
                  className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft"
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      checked={isSel}
                      onChange={() => toggleOne(n.id)}
                      aria-label="Select message"
                    />

                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--muted))]">
                        <span>{fmtDate(n.created_at)}</span>
                        <span>·</span>
                        {n.read_at ? (
                          <Badge className="bg-black text-white border-black">Read</Badge>
                        ) : (
                          <Badge>Unread</Badge>
                        )}
                      </div>

                      <div className="mt-1 font-medium">{n.title || 'Message from member'}</div>

                      <div className="mt-2 whitespace-pre-wrap text-sm">{n.body}</div>

                      {n.created_by && (
                        <div className="mt-2 text-xs text-[hsl(var(--muted))]">
                          {/* reserved for author info if you expose it later */}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button variant="outline" onClick={() => load(Math.max(1, page - 1))} disabled={page <= 1 || loading}>
            Prev
          </Button>
          <div className="sm:ml-auto text-xs text-[hsl(var(--muted))]">
            Page <strong>{page}</strong> / {totalPages} · Total {total}
          </div>
          <Button
            variant="outline"
            onClick={() => load(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages || loading}
          >
            Next
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
