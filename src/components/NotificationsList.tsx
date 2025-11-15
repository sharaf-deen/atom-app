// src/components/NotificationsList.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'

type Box = 'inbox' | 'sent'
type Item = {
  id: string
  title: string | null
  body: string
  kind: string | null
  created_at: string
  read_at?: string | null
  created_by?: string | null
  user_id?: string | null
  recipient_name?: string
  recipient_email?: string | null
}

const KINDS = ['all', 'info', 'order_update', 'billing', 'promo'] as const
type KindFilter = typeof KINDS[number]

// ✅ Fixe à 5 par page
const PER_PAGE = 5

type Props = {
  isAdmin?: boolean
  /** si true, on force l’onglet "Sent" et on masque l’Inbox et ses actions */
  sentOnly?: boolean
}

export default function NotificationsList({ isAdmin = false, sentOnly = false }: Props) {
  // Si sentOnly, on fige la boîte à 'sent'
  const [box, setBox] = useState<Box>(sentOnly ? 'sent' : 'inbox')
  const [tab, setTab] = useState<'all' | 'unread'>('all') // seulement pour inbox
  const [kind, setKind] = useState<KindFilter>('all')
  const [q, setQ] = useState('')
  const [debQ, setDebQ] = useState('')

  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Si la prop change dynamiquement, réaligne l’onglet
  useEffect(() => {
    if (sentOnly) setBox('sent')
  }, [sentOnly])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PER_PAGE)), [total])

  useEffect(() => {
    const t = setTimeout(() => setDebQ(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  async function load(p = page) {
    setLoading(true)
    setErr('')
    try {
      const params = new URLSearchParams()
      params.set('page', String(p))
      params.set('limit', String(PER_PAGE)) // ✅ toujours 5
      if (kind !== 'all') params.set('kind', kind)
      if (debQ) params.set('q', debQ)

      let url = '/api/notifications/list'
      if (!sentOnly && box === 'inbox' && tab === 'unread') {
        params.set('unread', '1')
      }
      if (sentOnly || box === 'sent') {
        url = '/api/notifications/sent/list'
      }

      const r = await fetch(`${url}?${params.toString()}`, { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        setErr(j?.details || j?.error || 'Failed to load')
        setItems([])
        setTotal(0)
        return
      }
      setItems(Array.isArray(j.items) ? j.items : [])
      setTotal(Number(j.total || 0))
      setPage(Number(j.page || p)) // garde la page renvoyée ou celle demandée
      setSelected(new Set())
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setPage(1)
    load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box, tab, kind, debQ, sentOnly])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAll() {
    if (selected.size === items.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(items.map((i) => i.id)))
    }
  }

  async function markSelectedRead() {
    if (sentOnly || box !== 'inbox' || selected.size === 0) return
    const ids = Array.from(selected)
    const r = await fetch('/api/notifications/mark-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j?.ok) {
      alert(j?.details || j?.error || 'Failed to mark as read')
      return
    }
    await load(page)
  }

  async function markAllUnreadInFilterRead() {
    if (sentOnly || box !== 'inbox') return
    const params = new URLSearchParams()
    params.set('page', '1')
    params.set('limit', '1000')
    params.set('unread', '1')
    if (kind !== 'all') params.set('kind', kind)
    if (debQ) params.set('q', debQ)
    const r = await fetch(`/api/notifications/list?${params.toString()}`, { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j?.ok) {
      alert(j?.details || j?.error || 'Failed to load unread')
      return
    }
    const ids: string[] = (j.items || []).map((x: any) => x.id).filter(Boolean)
    if (ids.length === 0) {
      alert('No unread notifications in current filter.')
      return
    }
    const r2 = await fetch('/api/notifications/mark-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    const j2 = await r2.json().catch(() => ({}))
    if (!r2.ok || !j2?.ok) {
      alert(j2?.details || j2?.error || 'Failed to mark all as read')
      return
    }
    await load(page)
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
        <CardTitle>Notifications Sent</CardTitle>
      </CardHeader>

      <CardContent>
        {/* Header & filters */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {/* Onglets Inbox/Sent masqués si sentOnly */}
          {isAdmin && !sentOnly && (
            <div className="flex w-fit items-center gap-1 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-1">
              <button
                onClick={() => setBox('inbox')}
                className={
                  'rounded-xl px-3 py-1.5 text-sm ' +
                  (box === 'inbox'
                    ? 'bg-[hsl(var(--card))] border border-[hsl(var(--border))] shadow-soft'
                    : 'hover:bg-black/5')
                }
              >
                Inbox
              </button>
              <button
                onClick={() => setBox('sent')}
                className={
                  'rounded-xl px-3 py-1.5 text-sm ' +
                  (box === 'sent'
                    ? 'bg-[hsl(var(--card))] border border-[hsl(var(--border))] shadow-soft'
                    : 'hover:bg-black/5')
                }
              >
                Sent
              </button>
            </div>
          )}

          {/* Onglets All/Unread seulement si Inbox visible */}
          {!sentOnly && box === 'inbox' && (
            <div className="flex w-fit items-center gap-1 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-1">
              <button
                onClick={() => setTab('all')}
                className={
                  'rounded-xl px-3 py-1.5 text-sm ' +
                  (tab === 'all'
                    ? 'bg-[hsl(var(--card))] border border-[hsl(var(--border))] shadow-soft'
                    : 'hover:bg-black/5')
                }
              >
                All
              </button>
              <button
                onClick={() => setTab('unread')}
                className={
                  'rounded-xl px-3 py-1.5 text-sm ' +
                  (tab === 'unread'
                    ? 'bg-[hsl(var(--card))] border border-[hsl(var(--border))] shadow-soft'
                    : 'hover:bg-black/5')
                }
              >
                Unread
              </button>
            </div>
          )}

          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value as any)}
            className="sm:w-40"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k === 'all' ? 'All kinds' : k}
              </option>
            ))}
          </Select>

          <div className="sm:max-w-xs w-full">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search title/body…"
              aria-label="Search notifications"
            />
          </div>

          <div className="sm:ml-auto flex items-center gap-2">
            <Button
              onClick={() => load(page)}
              variant="outline"
              disabled={loading}
              className="px-3 py-2"
            >
              {loading ? 'Loading…' : 'Refresh'}
            </Button>

            {/* Boutons de lecture : seulement si Inbox visible */}
            {!sentOnly && box === 'inbox' && (
              <>
                <Button
                  onClick={markSelectedRead}
                  disabled={selected.size === 0 || loading}
                  className="px-3 py-2"
                >
                  Mark selected as read
                </Button>
                <Button
                  onClick={markAllUnreadInFilterRead}
                  variant="outline"
                  disabled={loading}
                  className="px-3 py-2"
                  title="Mark all unread in current filter"
                >
                  Mark all unread (filter)
                </Button>
              </>
            )}
          </div>
        </div>

        {err && (
          <div className="mt-3 rounded-2xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {err}
          </div>
        )}

        {/* Table responsive */}
        <div className="mt-4">
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-soft md:block">
            <table className="min-w-full text-sm">
              <thead className="bg-[hsl(var(--bg))] text-left">
                <tr>
                  <th className="border-b border-[hsl(var(--border))] p-3">
                    {!sentOnly && box === 'inbox' && (
                      <input
                        type="checkbox"
                        checked={selected.size === items.length && items.length > 0}
                        onChange={toggleAll}
                        aria-label="Select all"
                      />
                    )}
                  </th>
                  <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Title</th>
                  <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Message</th>
                  <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Kind</th>
                  <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Created</th>
                  <th className="border-b border-[hsl(var(--border))] p-3 font-medium">
                    {sentOnly || box === 'sent' ? 'Recipient' : 'Status'}
                  </th>
                  <th className="border-b border-[hsl(var(--border))] p-3" />
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-4 text-[hsl(var(--muted))]">
                      No notifications.
                    </td>
                  </tr>
                ) : (
                  items.map((n) => (
                    <tr key={n.id} className="odd:bg-[hsl(var(--card))] even:bg-[hsl(var(--bg))] align-top">
                      <td className="border-t border-[hsl(var(--border))] p-3">
                        {!sentOnly && box === 'inbox' && (
                          <input
                            type="checkbox"
                            checked={selected.has(n.id)}
                            onChange={() => toggle(n.id)}
                            aria-label="Select row"
                          />
                        )}
                      </td>
                      <td className="border-t border-[hsl(var(--border))] p-3 font-medium">
                        {n.title || '—'}
                      </td>
                      <td className="border-t border-[hsl(var(--border))] p-3 whitespace-pre-wrap">
                        {n.body}
                      </td>
                      <td className="border-t border-[hsl(var(--border))] p-3">
                        <Badge>{n.kind || '—'}</Badge>
                      </td>
                      <td className="border-t border-[hsl(var(--border))] p-3">
                        {fmtDate(n.created_at)}
                      </td>
                      <td className="border-t border-[hsl(var(--border))] p-3">
                        {sentOnly || box === 'sent' ? (
                          <div className="text-xs">
                            <div className="font-medium">{n.recipient_name || '—'}</div>
                            <div className="text-[hsl(var(--muted))]">{n.recipient_email || ''}</div>
                          </div>
                        ) : n.read_at ? (
                          <Badge className="bg-black text-white border-black">Read</Badge>
                        ) : (
                          <Badge>Unread</Badge>
                        )}
                      </td>
                      <td className="border-t border-[hsl(var(--border))] p-3">
                        {!sentOnly && box === 'inbox' && !n.read_at && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              const r = await fetch('/api/notifications/mark-read', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ ids: [n.id] }),
                              })
                              const j = await r.json().catch(() => ({}))
                              if (!r.ok || !j?.ok) {
                                alert(j?.details || j?.error || 'Failed')
                                return
                              }
                              await load(page)
                            }}
                          >
                            Mark as read
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {items.length === 0 ? (
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 text-[hsl(var(--muted))]">
                No notifications.
              </div>
            ) : (
              items.map((n) => (
                <div key={n.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="font-semibold">{n.title || '—'}</div>
                    {!sentOnly && box === 'inbox' && (
                      <input
                        type="checkbox"
                        checked={selected.has(n.id)}
                        onChange={() => toggle(n.id)}
                        aria-label="Select"
                      />
                    )}
                  </div>
                  <div className="mb-2 whitespace-pre-wrap text-sm">{n.body}</div>
                  <div className="mb-1 text-sm">
                    <span className="text-[hsl(var(--muted))]">Kind:</span>{' '}
                    <Badge>{n.kind || '—'}</Badge>
                  </div>
                  <div className="mb-1 text-sm">
                    <span className="text-[hsl(var(--muted))]">Created:</span> {fmtDate(n.created_at)}
                  </div>
                  <div className="mb-3 text-sm">
                    {sentOnly || box === 'sent' ? (
                      <>
                        <span className="text-[hsl(var(--muted))]">Recipient:</span>{' '}
                        <span className="font-medium">{n.recipient_name || '—'}</span>
                        {n.recipient_email ? (
                          <span className="text-[hsl(var(--muted))]"> · {n.recipient_email}</span>
                        ) : null}
                      </>
                    ) : n.read_at ? (
                      <Badge className="bg-black text-white border-black">Read</Badge>
                    ) : (
                      <Badge>Unread</Badge>
                    )}
                  </div>

                  {!sentOnly && box === 'inbox' && !n.read_at && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        const r = await fetch('/api/notifications/mark-read', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ ids: [n.id] }),
                        })
                        const j = await r.json().catch(() => ({}))
                        if (!r.ok || !j?.ok) {
                          alert(j?.details || j?.error || 'Failed')
                          return
                        }
                        await load(page)
                      }}
                    >
                      Mark as read
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Pagination */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => load(Math.max(1, page - 1))}
            disabled={page <= 1 || loading}
          >
            Prev
          </Button>
          <div className="text-xs text-[hsl(var(--muted))]">
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
