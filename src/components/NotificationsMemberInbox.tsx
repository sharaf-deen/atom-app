"use client"

import { useEffect, useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'

type SortMode = 'recent' | 'unread_first' | 'important_first'
type Item = {
  id: string
  title: string | null
  body: string
  kind: string | null
  created_at: string
  read_at: string | null
  created_by: string | null
  sender_name?: string
  sender_email?: string | null
}

const PER_PAGE = 5

type Props = {
  canDelete?: boolean
}

async function safeJson(r: Response) {
  try {
    return await r.json()
  } catch {
    return {}
  }
}

function preview(text: string, max = 130) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  if (!s) return '—'
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function toMs(iso: string) {
  const n = new Date(iso).getTime()
  return Number.isFinite(n) ? n : 0
}

function isRecent(iso: string, hours = 72) {
  const ms = toMs(iso)
  return ms > 0 && Date.now() - ms <= hours * 60 * 60 * 1000
}

function isImportant(item: Item) {
  return !item.read_at && isRecent(item.created_at, 48)
}

function sortItems(items: Item[], mode: SortMode) {
  const copy = [...items]
  copy.sort((a, b) => {
    const aUnread = !a.read_at ? 1 : 0
    const bUnread = !b.read_at ? 1 : 0
    const aRecent = isRecent(a.created_at) ? 1 : 0
    const bRecent = isRecent(b.created_at) ? 1 : 0
    const aImportant = isImportant(a) ? 1 : 0
    const bImportant = isImportant(b) ? 1 : 0

    if (mode === 'unread_first' && aUnread !== bUnread) return bUnread - aUnread
    if (mode === 'important_first' && aImportant !== bImportant) return bImportant - aImportant
    if (mode === 'recent' && aRecent !== bRecent) return bRecent - aRecent

    if (mode !== 'unread_first' && aUnread !== bUnread) return bUnread - aUnread
    if (mode !== 'important_first' && aImportant !== bImportant) return bImportant - aImportant
    if (mode !== 'recent' && aRecent !== bRecent) return bRecent - aRecent

    return toMs(b.created_at) - toMs(a.created_at)
  })
  return copy
}

export default function NotificationsMemberInbox({ canDelete = false }: Props) {
  const [q, setQ] = useState('')
  const [debQ, setDebQ] = useState('')
  const [tab, setTab] = useState<'all' | 'unread'>('all')
  const [sortMode, setSortMode] = useState<SortMode>('unread_first')

  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [actionMsg, setActionMsg] = useState('')

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PER_PAGE)), [total])
  const visibleItems = useMemo(() => sortItems(items, sortMode), [items, sortMode])
  const openItem = useMemo(() => visibleItems.find((item) => item.id === openId) ?? null, [visibleItems, openId])
  const unreadOnPage = useMemo(() => visibleItems.filter((item) => !item.read_at).length, [visibleItems])
  const recentOnPage = useMemo(() => visibleItems.filter((item) => isRecent(item.created_at)).length, [visibleItems])
  const importantOnPage = useMemo(() => visibleItems.filter((item) => isImportant(item)).length, [visibleItems])
  const selectedReadIds = useMemo(
    () => visibleItems.filter((item) => selected.has(item.id) && !!item.read_at).map((item) => item.id),
    [visibleItems, selected],
  )
  const selectedUnreadIds = useMemo(
    () => visibleItems.filter((item) => selected.has(item.id) && !item.read_at).map((item) => item.id),
    [visibleItems, selected],
  )

  useEffect(() => {
    const t = setTimeout(() => setDebQ(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    if (openId && !visibleItems.some((item) => item.id === openId)) {
      setOpenId(null)
    }
  }, [visibleItems, openId])

  async function load(p = page) {
    setLoading(true)
    setErr('')
    try {
      const params = new URLSearchParams()
      params.set('page', String(p))
      params.set('limit', String(PER_PAGE))
      if (debQ) params.set('q', debQ)
      if (tab === 'unread') params.set('unread', '1')

      const r = await fetch(`/api/notifications/member-messages/list?${params.toString()}`, { cache: 'no-store' })
      const j: any = await safeJson(r)

      if (!r.ok || !j?.ok) {
        setErr(j?.details || j?.error || 'Failed to load')
        setItems([])
        setTotal(0)
        return
      }

      const nextItems = Array.isArray(j.items) ? j.items : []
      setItems(nextItems)
      setTotal(Number(j.total || 0))
      setPage(Number(j.page || p))
      setSelected(new Set())
      if (!openId && nextItems.length > 0) setOpenId(nextItems[0].id)
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setPage(1)
    setOpenId(null)
    load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debQ, tab])

  useEffect(() => {
    const handler = () => load(page)
    window.addEventListener('notifications:updated', handler)
    return () => window.removeEventListener('notifications:updated', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllVisible() {
    if (selected.size === visibleItems.length && visibleItems.length > 0) setSelected(new Set())
    else setSelected(new Set(visibleItems.map((item) => item.id)))
  }

  function selectUnreadVisible() {
    setSelected(new Set(visibleItems.filter((item) => !item.read_at).map((item) => item.id)))
  }

  async function markIds(ids: string[], mode: 'read' | 'unread') {
    if (ids.length === 0) return true
    const endpoint = mode === 'read' ? '/api/notifications/mark-read' : '/api/notifications/mark-unread'
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    const j: any = await safeJson(r)
    if (!r.ok || !j?.ok) {
      setActionMsg(j?.details || j?.error || `Failed to mark as ${mode}`)
      return false
    }
    setActionMsg(`Marked ${ids.length} message${ids.length === 1 ? '' : 's'} as ${mode}.`)
    window.dispatchEvent(new Event('notifications:updated'))
    return true
  }

  async function openItemAndRead(item: Item) {
    setOpenId(item.id)
    if (!item.read_at) {
      const ok = await markIds([item.id], 'read')
      if (ok) await load(page)
    }
  }

  async function deleteIds(ids: string[]) {
    if (!canDelete) return false
    const r = await fetch('/api/notifications/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, scope: 'inbox' }),
    })

    const j: any = await safeJson(r)
    if (!r.ok || !j?.ok) {
      setActionMsg(j?.details || j?.error || 'Failed to delete')
      return false
    }

    setActionMsg(`Deleted ${ids.length} message${ids.length === 1 ? '' : 's'} from your inbox.`)
    window.dispatchEvent(new Event('notifications:updated'))
    return true
  }

  async function deleteOne(id: string) {
    if (!canDelete) return
    if (!confirm('Delete this message for you? This will not delete it for the member.')) return
    const ok = await deleteIds([id])
    if (!ok) return
    if (openId === id) setOpenId(null)
    const willEmpty = visibleItems.length === 1 && page > 1
    await load(willEmpty ? page - 1 : page)
  }

  async function markSelectedRead() {
    if (selectedUnreadIds.length === 0) return
    const ok = await markIds(selectedUnreadIds, 'read')
    if (ok) await load(page)
  }

  async function markSelectedUnread() {
    if (selectedReadIds.length === 0) return
    const ok = await markIds(selectedReadIds, 'unread')
    if (ok) await load(page)
  }

  async function deleteSelected() {
    if (!canDelete || selected.size === 0) return
    const ids = Array.from(selected)
    if (!confirm(`Delete ${ids.length} member message(s) from your inbox?`)) return
    const ok = await deleteIds(ids)
    if (!ok) return
    const willEmpty = ids.length >= visibleItems.length && page > 1
    await load(willEmpty ? page - 1 : page)
  }

  function fmtDate(iso: string) {
    try {
      return new Date(iso).toLocaleString()
    } catch {
      return iso
    }
  }

  return (
    <Card hover>
      <CardHeader className="items-start">
        <CardTitle>Member messages inbox</CardTitle>
      </CardHeader>

      <CardContent>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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

          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="h-10 rounded-xl border border-[hsl(var(--border))] bg-white px-3 text-sm sm:w-44"
          >
            <option value="unread_first">Unread first</option>
            <option value="recent">Recent first</option>
            <option value="important_first">Important first</option>
          </select>

          <div className="w-full sm:max-w-xs">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search member messages…" aria-label="Search messages" />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={markSelectedRead} disabled={selectedUnreadIds.length === 0 || loading} variant="outline" size="sm">
            Mark selected read
          </Button>
          <Button onClick={markSelectedUnread} disabled={selectedReadIds.length === 0 || loading} variant="outline" size="sm">
            Mark selected unread
          </Button>
          {canDelete ? (
            <Button onClick={deleteSelected} disabled={selected.size === 0 || loading} variant="outline" size="sm">
              Delete selected
            </Button>
          ) : null}
          <Button onClick={selectUnreadVisible} disabled={unreadOnPage === 0 || loading} variant="outline" size="sm">
            Select unread on page
          </Button>
          <Button onClick={toggleAllVisible} disabled={visibleItems.length === 0 || loading} variant="outline" size="sm">
            {selected.size === visibleItems.length && visibleItems.length > 0 ? 'Clear page selection' : 'Select page'}
          </Button>
          {selected.size > 0 ? (
            <Button onClick={() => setSelected(new Set())} variant="outline" size="sm">
              Clear selection
            </Button>
          ) : null}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-[hsl(var(--muted))]">View</div>
            <div className="mt-1 text-lg font-semibold">{tab === 'unread' ? 'Unread' : 'All messages'}</div>
          </div>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-[hsl(var(--muted))]">Visible</div>
            <div className="mt-1 text-lg font-semibold">{visibleItems.length}</div>
          </div>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-[hsl(var(--muted))]">Unread on page</div>
            <div className="mt-1 text-lg font-semibold">{unreadOnPage}</div>
          </div>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-[hsl(var(--muted))]">Recent on page</div>
            <div className="mt-1 text-lg font-semibold">{recentOnPage}</div>
          </div>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-[hsl(var(--muted))]">Selected</div>
            <div className="mt-1 text-lg font-semibold">{selected.size}</div>
            <div className="mt-1 text-xs text-[hsl(var(--muted))]">Important on page: {importantOnPage}</div>
          </div>
        </div>

        {actionMsg && (
          <div className="mt-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-2 text-sm text-[hsl(var(--muted))]">
            {actionMsg}
          </div>
        )}

        {err && (
          <div className="mt-3 rounded-2xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {err}
          </div>
        )}

        {openItem && (
          <div className="mt-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-base font-semibold">{openItem.title || 'Untitled member message'}</h4>
                  {isImportant(openItem) ? <Badge>Important</Badge> : null}
                  {isRecent(openItem.created_at) ? <Badge>Recent</Badge> : null}
                  {openItem.read_at ? <Badge className="bg-black text-white border-black">Read</Badge> : <Badge>Unread</Badge>}
                </div>
                <div className="text-xs text-[hsl(var(--muted))]">{fmtDate(openItem.created_at)}</div>
                <div className="text-sm text-[hsl(var(--muted))]">
                  From <span className="font-medium text-black">{openItem.sender_name || '—'}</span>
                  {openItem.sender_email ? ` · ${openItem.sender_email}` : ''}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {openItem.read_at ? (
                  <Button variant="outline" size="sm" onClick={async () => {
                    const ok = await markIds([openItem.id], 'unread')
                    if (ok) await load(page)
                  }}>
                    Mark unread
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={async () => {
                    const ok = await markIds([openItem.id], 'read')
                    if (ok) await load(page)
                  }}>
                    Mark read
                  </Button>
                )}
                {canDelete ? (
                  <Button variant="outline" size="sm" onClick={() => deleteOne(openItem.id)}>
                    Delete
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="mt-4 whitespace-pre-wrap text-sm leading-6">{openItem.body}</div>
          </div>
        )}

        <div className="mt-4">
          <div className="hidden overflow-x-auto rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-soft md:block">
            <table className="min-w-full text-sm">
              <thead className="bg-[hsl(var(--bg))] text-left">
                <tr>
                  <th className="border-b border-[hsl(var(--border))] p-3">
                    <input
                      type="checkbox"
                      checked={selected.size === visibleItems.length && visibleItems.length > 0}
                      onChange={toggleAllVisible}
                      aria-label="Select all visible"
                    />
                  </th>
                  <th className="border-b border-[hsl(var(--border))] p-3 font-medium">From</th>
                  <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Title</th>
                  <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Signals</th>
                  <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Preview</th>
                  <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Created</th>
                  <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Status</th>
                  <th className="border-b border-[hsl(var(--border))] p-3" />
                </tr>
              </thead>
              <tbody>
                {visibleItems.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-4 text-[hsl(var(--muted))]">
                      No member messages.
                    </td>
                  </tr>
                ) : (
                  visibleItems.map((m) => (
                    <tr key={m.id} className="odd:bg-[hsl(var(--card))] even:bg-[hsl(var(--bg))] align-top">
                      <td className="border-t border-[hsl(var(--border))] p-3">
                        <input
                          type="checkbox"
                          checked={selected.has(m.id)}
                          onChange={() => toggle(m.id)}
                          aria-label="Select row"
                        />
                      </td>
                      <td className="border-t border-[hsl(var(--border))] p-3">
                        <div className="text-xs">
                          <div className="font-medium">{m.sender_name || '—'}</div>
                          {m.sender_email ? <div className="text-[hsl(var(--muted))]">{m.sender_email}</div> : null}
                        </div>
                      </td>
                      <td className="border-t border-[hsl(var(--border))] p-3 font-medium">{m.title || '—'}</td>
                      <td className="border-t border-[hsl(var(--border))] p-3">
                        <div className="flex flex-wrap gap-2">
                          {isImportant(m) ? <Badge>Important</Badge> : null}
                          {isRecent(m.created_at) ? <Badge>Recent</Badge> : null}
                          {!m.read_at ? <Badge>Unread</Badge> : null}
                        </div>
                      </td>
                      <td className="border-t border-[hsl(var(--border))] p-3 text-[hsl(var(--muted))]">{preview(m.body)}</td>
                      <td className="border-t border-[hsl(var(--border))] p-3">{fmtDate(m.created_at)}</td>
                      <td className="border-t border-[hsl(var(--border))] p-3">
                        {m.read_at ? <Badge className="bg-black text-white border-black">Read</Badge> : <Badge>Unread</Badge>}
                      </td>
                      <td className="border-t border-[hsl(var(--border))] p-3">
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" onClick={() => openItemAndRead(m)}>
                            Open
                          </Button>
                          {m.read_at ? (
                            <Button variant="outline" size="sm" onClick={async () => {
                              const ok = await markIds([m.id], 'unread')
                              if (ok) await load(page)
                            }}>
                              Unread
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" onClick={async () => {
                              const ok = await markIds([m.id], 'read')
                              if (ok) await load(page)
                            }}>
                              Read
                            </Button>
                          )}
                          {canDelete ? (
                            <Button variant="outline" size="sm" onClick={() => deleteOne(m.id)}>
                              Delete
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 md:hidden">
            {visibleItems.length === 0 ? (
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 text-[hsl(var(--muted))]">
                No member messages.
              </div>
            ) : (
              visibleItems.map((m) => (
                <div key={m.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
                  <div className="mb-1 text-xs">
                    <span className="text-[hsl(var(--muted))]">From:</span>{' '}
                    <span className="font-medium">{m.sender_name || '—'}</span>
                    {m.sender_email ? <span className="text-[hsl(var(--muted))]"> · {m.sender_email}</span> : null}
                  </div>
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">{m.title || '—'}</div>
                      <div className="mt-1 text-xs text-[hsl(var(--muted))]">{fmtDate(m.created_at)}</div>
                    </div>
                    <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} aria-label="Select" />
                  </div>
                  <div className="mb-2 text-sm text-[hsl(var(--muted))]">{preview(m.body, 140)}</div>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    {isImportant(m) ? <Badge>Important</Badge> : null}
                    {isRecent(m.created_at) ? <Badge>Recent</Badge> : null}
                    {m.read_at ? <Badge className="bg-black text-white border-black">Read</Badge> : <Badge>Unread</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => openItemAndRead(m)}>
                      Open
                    </Button>
                    {m.read_at ? (
                      <Button variant="outline" size="sm" onClick={async () => {
                        const ok = await markIds([m.id], 'unread')
                        if (ok) await load(page)
                      }}>
                        Unread
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" onClick={async () => {
                        const ok = await markIds([m.id], 'read')
                        if (ok) await load(page)
                      }}>
                        Read
                      </Button>
                    )}
                    {canDelete ? (
                      <Button variant="outline" size="sm" onClick={() => deleteOne(m.id)}>
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {totalPages > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => load(Math.max(1, page - 1))} disabled={page <= 1 || loading}>
              Prev
            </Button>
            <div className="text-xs text-[hsl(var(--muted))]">
              Page <strong>{page}</strong> / {totalPages} · Total {total}
            </div>
            <Button variant="outline" onClick={() => load(Math.min(totalPages, page + 1))} disabled={page >= totalPages || loading}>
              Next
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
