"use client"

import { useEffect, useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'

type Box = 'inbox' | 'sent'
type SortMode = 'recent' | 'unread_first' | 'important_first'
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
  recipient_count?: number
  source_ids?: string[]
}

const KINDS = ['all', 'info', 'order_update', 'billing', 'promo'] as const
type KindFilter = (typeof KINDS)[number]
const PER_PAGE = 5

type Props = {
  isAdmin?: boolean
  sentOnly?: boolean
}

async function safeJson(r: Response) {
  try {
    return await r.json()
  } catch {
    return {}
  }
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
}

function kindLabel(kind: string | null | undefined) {
  switch (kind) {
    case 'order_update':
      return 'Order update'
    case 'billing':
      return 'Billing'
    case 'promo':
      return 'Promo'
    case 'info':
      return 'Info'
    default:
      return kind || '—'
  }
}

function preview(text: string, max = 120) {
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
  return item.kind === 'billing' || item.kind === 'order_update'
}

function sortItems(items: Item[], mode: SortMode, isSentView: boolean) {
  const copy = [...items]
  copy.sort((a, b) => {
    const aRecent = isRecent(a.created_at) ? 1 : 0
    const bRecent = isRecent(b.created_at) ? 1 : 0
    const aUnread = !isSentView && !a.read_at ? 1 : 0
    const bUnread = !isSentView && !b.read_at ? 1 : 0
    const aImportant = isImportant(a) ? 1 : 0
    const bImportant = isImportant(b) ? 1 : 0

    if (mode === 'unread_first' && aUnread !== bUnread) return bUnread - aUnread
    if (mode === 'important_first' && aImportant !== bImportant) return bImportant - aImportant
    if (mode === 'recent' && aRecent !== bRecent) return bRecent - aRecent

    if (!isSentView && mode !== 'unread_first' && aUnread !== bUnread) return bUnread - aUnread
    if (mode !== 'important_first' && aImportant !== bImportant) return bImportant - aImportant
    if (mode !== 'recent' && aRecent !== bRecent) return bRecent - aRecent

    return toMs(b.created_at) - toMs(a.created_at)
  })
  return copy
}

export default function NotificationsList({ isAdmin = false, sentOnly = false }: Props) {
  const [box, setBox] = useState<Box>(sentOnly ? 'sent' : 'inbox')
  const [tab, setTab] = useState<'all' | 'unread'>('all')
  const [kind, setKind] = useState<KindFilter>('all')
  const [sortMode, setSortMode] = useState<SortMode>('unread_first')
  const [q, setQ] = useState('')
  const [debQ, setDebQ] = useState('')

  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openId, setOpenId] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState('')
  const [audCounts, setAudCounts] = useState<{ members: number; coaches: number; assistant_coaches: number; head_coaches: number } | null>(
    null,
  )

  useEffect(() => {
    if (sentOnly) setBox('sent')
  }, [sentOnly])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PER_PAGE)), [total])
  const isSentView = sentOnly || box === 'sent'
  const visibleItems = useMemo(() => sortItems(items, sortMode, isSentView), [items, sortMode, isSentView])
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

  async function ensureAudienceCounts() {
    if (audCounts) return audCounts
    try {
      const r = await fetch('/api/notifications/audience-counts', { cache: 'no-store' })
      const j: any = await safeJson(r)
      if (r.ok && j?.ok) {
        const next = {
          members: Number(j.members || 0),
          coaches: Number(j.coaches || 0),
          assistant_coaches: Number(j.assistant_coaches || 0),
          head_coaches: Number(j.head_coaches || 0),
        }
        setAudCounts(next)
        return next
      }
    } catch {}
    return { members: 0, coaches: 0, assistant_coaches: 0, head_coaches: 0 }
  }

  function groupSent(rows: any[], counts: { members: number; coaches: number; assistant_coaches: number; head_coaches: number }): Item[] {
    const norm = (s: any) => String(s ?? '').trim().replace(/\s+/g, ' ')
    const timeKey = (iso: any) => {
      const s = String(iso ?? '')
      return s.length >= 19 ? s.slice(0, 19) : s
    }

    const out: Item[] = []
    const map = new Map<string, { item: Item; recipients: { name?: string; email?: string | null }[] }>()

    for (const r of rows) {
      const k = `${timeKey(r.created_at)}|${norm(r.kind)}|${norm(r.title)}|${norm(r.body)}`
      let g = map.get(k)
      if (!g) {
        const base: Item = {
          id: k,
          title: r.title ?? null,
          body: String(r.body ?? ''),
          kind: r.kind ?? null,
          created_at: String(r.created_at ?? ''),
          source_ids: [],
        }
        g = { item: base, recipients: [] }
        map.set(k, g)
        out.push(g.item)
      }

      if (typeof r.id === 'string' && isUuid(r.id)) {
        g.item.source_ids = g.item.source_ids || []
        g.item.source_ids.push(r.id)
      }

      g.recipients.push({
        name: (r.recipient_name ?? r.recipient ?? '') as any,
        email: (r.recipient_email ?? r.recipientEmail ?? null) as any,
      })

      if (typeof r.recipient_count === 'number' && r.recipient_count > 0) {
        g.item.recipient_count = r.recipient_count
        g.item.recipient_name = r.recipient_name
        g.item.recipient_email = r.recipient_email ?? null
      }
    }

    for (const item of out) {
      if (typeof item.recipient_count === 'number' && item.recipient_count > 0) continue

      const g = map.get(item.id)
      const n = g?.recipients.length || 0
      item.recipient_count = n

      if (n === 1) {
        item.recipient_name = (g?.recipients[0]?.name || '—').toString().trim() || '—'
        item.recipient_email = g?.recipients[0]?.email ?? null
      } else if (n > 1) {
        if (counts.members > 0 && n === counts.members) item.recipient_name = 'All members'
        else if (counts.coaches > 0 && n === counts.coaches) item.recipient_name = 'All coaches'
        else if (counts.assistant_coaches > 0 && n === counts.assistant_coaches) item.recipient_name = 'All assistant coaches'
        else if (counts.coaches + counts.assistant_coaches + counts.head_coaches > 0 && n === counts.coaches + counts.assistant_coaches + counts.head_coaches) item.recipient_name = 'All coaches + assistants + head coaches'
        else item.recipient_name = `Custom (${n})`
        item.recipient_email = null
      } else {
        item.recipient_name = '—'
        item.recipient_email = null
      }
    }

    return out
  }

  async function load(p = page) {
    setLoading(true)
    setErr('')
    try {
      const params = new URLSearchParams()

      if (isSentView) {
        params.set('page', '1')
        params.set('limit', '1000')
        if (kind !== 'all') params.set('kind', kind)
        if (debQ) params.set('q', debQ)

        const [counts, r] = await Promise.all([
          ensureAudienceCounts(),
          fetch(`/api/notifications/sent/list?${params.toString()}`, { cache: 'no-store' }),
        ])
        const j: any = await safeJson(r)

        if (!r.ok || !j?.ok) {
          setErr(j?.details || j?.error || 'Failed to load')
          setItems([])
          setTotal(0)
          return
        }

        const raw = Array.isArray(j.items) ? j.items : []
        const alreadyGrouped = raw.length > 0 && typeof raw[0]?.recipient_count === 'number' && !raw[0]?.user_id
        const grouped: Item[] = alreadyGrouped ? (raw as Item[]) : groupSent(raw, counts)

        const totalGroups = grouped.length
        const offset = (p - 1) * PER_PAGE
        const nextItems = grouped.slice(offset, offset + PER_PAGE)
        setItems(nextItems)
        setTotal(totalGroups)
        setPage(p)
        setSelected(new Set())
        if (!openId && nextItems.length > 0) setOpenId(nextItems[0].id)
        return
      }

      params.set('page', String(p))
      params.set('limit', String(PER_PAGE))
      if (kind !== 'all') params.set('kind', kind)
      if (debQ) params.set('q', debQ)
      if (tab === 'unread') params.set('unread', '1')

      const r = await fetch(`/api/notifications/list?${params.toString()}`, { cache: 'no-store' })
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
  }, [box, tab, kind, debQ, sentOnly])

  useEffect(() => {
    const handler = () => load(page)
    window.addEventListener('atom:reload', handler)
    window.addEventListener('notifications:updated', handler)
    return () => {
      window.removeEventListener('atom:reload', handler)
      window.removeEventListener('notifications:updated', handler)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, box, tab, kind, debQ, sentOnly])

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
    setActionMsg(`Marked ${ids.length} notification${ids.length === 1 ? '' : 's'} as ${mode}.`)
    window.dispatchEvent(new Event('notifications:updated'))
    return true
  }

  async function openItemAndRead(item: Item) {
    setOpenId(item.id)
    if (!isSentView && !item.read_at) {
      const ok = await markIds([item.id], 'read')
      if (ok) await load(page)
    }
  }

  async function markSelectedRead() {
    if (isSentView || selectedUnreadIds.length === 0) return
    const ok = await markIds(selectedUnreadIds, 'read')
    if (ok) await load(page)
  }

  async function markSelectedUnread() {
    if (isSentView || selectedReadIds.length === 0) return
    const ok = await markIds(selectedReadIds, 'unread')
    if (ok) await load(page)
  }

  async function markAllUnreadInFilterRead() {
    if (isSentView) return
    const params = new URLSearchParams()
    params.set('page', '1')
    params.set('limit', '1000')
    params.set('unread', '1')
    if (kind !== 'all') params.set('kind', kind)
    if (debQ) params.set('q', debQ)

    const r = await fetch(`/api/notifications/list?${params.toString()}`, { cache: 'no-store' })
    const j: any = await safeJson(r)
    if (!r.ok || !j?.ok) {
      setActionMsg(j?.details || j?.error || 'Failed to load unread')
      return
    }

    const ids: string[] = (j.items || []).map((x: any) => x.id).filter(Boolean)
    if (ids.length === 0) {
      setActionMsg('No unread notifications in the current filter.')
      return
    }

    const ok = await markIds(ids, 'read')
    if (ok) await load(page)
  }

  async function deleteIds(ids: string[], scope: 'inbox' | 'sent' = 'inbox') {
    const r = await fetch('/api/notifications/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, scope }),
    })
    const j: any = await safeJson(r)
    if (!r.ok || !j?.ok) {
      setActionMsg(j?.details || j?.error || 'Failed to delete')
      return false
    }
    setActionMsg(`Deleted ${ids.length} notification${ids.length === 1 ? '' : 's'} from ${scope}.`)
    window.dispatchEvent(new Event('notifications:updated'))
    return true
  }

  async function deleteSelected() {
    if (isSentView || selected.size === 0) return
    const ids = Array.from(selected)
    if (!confirm(`Delete ${ids.length} notification(s)? This cannot be undone.`)) return
    const ok = await deleteIds(ids, 'inbox')
    if (!ok) return
    const willEmpty = ids.length >= visibleItems.length && page > 1
    await load(willEmpty ? page - 1 : page)
  }

  async function deleteOne(id: string) {
    if (isSentView) return
    if (!confirm('Delete this notification? This cannot be undone.')) return
    const ok = await deleteIds([id], 'inbox')
    if (!ok) return
    if (openId === id) setOpenId(null)
    const willEmpty = visibleItems.length === 1 && page > 1
    await load(willEmpty ? page - 1 : page)
  }

  async function deleteSentOne(item: Item) {
    if (!isSentView) return
    const ids = Array.isArray(item.source_ids) && item.source_ids.length > 0 ? item.source_ids : isUuid(item.id) ? [item.id] : []
    if (ids.length === 0) {
      setActionMsg('Cannot delete this sent row because its source ids are missing.')
      return
    }
    if (!confirm(`Delete this sent notification for you? (${ids.length} recipient${ids.length === 1 ? '' : 's'})`)) return
    const ok = await deleteIds(ids, 'sent')
    if (!ok) return
    if (openId === item.id) setOpenId(null)
    const willEmpty = visibleItems.length === 1 && page > 1
    await load(willEmpty ? page - 1 : page)
  }

  function fmtDate(iso: string) {
    try {
      return new Date(iso).toLocaleString()
    } catch {
      return iso
    }
  }

  function rowSignals(item: Item) {
    return {
      recent: isRecent(item.created_at),
      important: isImportant(item),
      unread: !isSentView && !item.read_at,
    }
  }

  return (
    <Card hover>
      <CardHeader className="items-start">
        <CardTitle>{isSentView ? 'Sent notifications' : 'My inbox'}</CardTitle>
      </CardHeader>

      <CardContent>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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

          {!isSentView && (
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

          <Select value={kind} onChange={(e) => setKind(e.target.value as KindFilter)} className="sm:w-44">
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k === 'all' ? 'All kinds' : kindLabel(k)}
              </option>
            ))}
          </Select>

          <Select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)} className="sm:w-44">
            <option value="unread_first">Unread first</option>
            <option value="recent">Recent first</option>
            <option value="important_first">Important first</option>
          </Select>

          <div className="w-full sm:max-w-xs">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={isSentView ? 'Search sent title/body…' : 'Search inbox title/body…'}
              aria-label="Search notifications"
            />
          </div>
        </div>

        {!isSentView && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={markSelectedRead} disabled={selectedUnreadIds.length === 0 || loading} variant="outline" size="sm">
              Mark selected read
            </Button>
            <Button onClick={markSelectedUnread} disabled={selectedReadIds.length === 0 || loading} variant="outline" size="sm">
              Mark selected unread
            </Button>
            <Button onClick={deleteSelected} variant="outline" disabled={selected.size === 0 || loading} size="sm">
              Delete selected
            </Button>
            <Button onClick={markAllUnreadInFilterRead} variant="outline" disabled={loading} size="sm">
              Mark unread in filter
            </Button>
            <Button onClick={selectUnreadVisible} variant="outline" disabled={unreadOnPage === 0 || loading} size="sm">
              Select unread on page
            </Button>
            <Button onClick={toggleAllVisible} variant="outline" disabled={visibleItems.length === 0 || loading} size="sm">
              {selected.size === visibleItems.length && visibleItems.length > 0 ? 'Clear page selection' : 'Select page'}
            </Button>
            {selected.size > 0 ? (
              <Button onClick={() => setSelected(new Set())} variant="outline" size="sm">
                Clear selection
              </Button>
            ) : null}
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-[hsl(var(--muted))]">View</div>
            <div className="mt-1 text-lg font-semibold">{isSentView ? 'Sent' : tab === 'unread' ? 'Unread inbox' : 'All inbox'}</div>
          </div>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-[hsl(var(--muted))]">Visible</div>
            <div className="mt-1 text-lg font-semibold">{visibleItems.length}</div>
          </div>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-[hsl(var(--muted))]">Unread on page</div>
            <div className="mt-1 text-lg font-semibold">{isSentView ? '—' : unreadOnPage}</div>
          </div>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-[hsl(var(--muted))]">Recent on page</div>
            <div className="mt-1 text-lg font-semibold">{recentOnPage}</div>
          </div>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-[hsl(var(--muted))]">Selected</div>
            <div className="mt-1 text-lg font-semibold">{selected.size}</div>
            {!isSentView ? <div className="mt-1 text-xs text-[hsl(var(--muted))]">Important on page: {importantOnPage}</div> : null}
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
                  <h4 className="text-base font-semibold">{openItem.title || 'Untitled notification'}</h4>
                  <Badge>{kindLabel(openItem.kind)}</Badge>
                  {rowSignals(openItem).important ? <Badge>Important</Badge> : null}
                  {rowSignals(openItem).recent ? <Badge>Recent</Badge> : null}
                  {!isSentView ? openItem.read_at ? <Badge className="bg-black text-white border-black">Read</Badge> : <Badge>Unread</Badge> : null}
                </div>
                <div className="text-xs text-[hsl(var(--muted))]">{fmtDate(openItem.created_at)}</div>
                {isSentView ? (
                  <div className="text-sm text-[hsl(var(--muted))]">
                    Recipient: <span className="font-medium text-black">{openItem.recipient_name || '—'}</span>
                    {openItem.recipient_email ? ` · ${openItem.recipient_email}` : ''}
                    {typeof openItem.recipient_count === 'number'
                      ? ` · ${openItem.recipient_count} recipient${openItem.recipient_count === 1 ? '' : 's'}`
                      : ''}
                  </div>
                ) : (
                  <div className="text-sm text-[hsl(var(--muted))]">
                    Triage: {rowSignals(openItem).unread ? 'Unread first' : 'Already read'}
                    {rowSignals(openItem).recent ? ' · Recent' : ''}
                    {rowSignals(openItem).important ? ' · Important' : ''}
                  </div>
                )}
              </div>

              {!isSentView ? (
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
                  <Button variant="outline" size="sm" onClick={() => deleteOne(openItem.id)}>
                    Delete
                  </Button>
                </div>
              ) : isAdmin ? (
                <Button variant="outline" size="sm" onClick={() => deleteSentOne(openItem)}>
                  Delete sent row
                </Button>
              ) : null}
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
                    {!isSentView && (
                      <input
                        type="checkbox"
                        checked={selected.size === visibleItems.length && visibleItems.length > 0}
                        onChange={toggleAllVisible}
                        aria-label="Select all visible"
                      />
                    )}
                  </th>
                  <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Title</th>
                  <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Preview</th>
                  <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Signals</th>
                  <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Created</th>
                  <th className="border-b border-[hsl(var(--border))] p-3 font-medium">{isSentView ? 'Recipient' : 'Status'}</th>
                  <th className="border-b border-[hsl(var(--border))] p-3" />
                </tr>
              </thead>
              <tbody>
                {visibleItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-4 text-[hsl(var(--muted))]">
                      {isSentView ? 'No sent notifications.' : 'No inbox notifications.'}
                    </td>
                  </tr>
                ) : (
                  visibleItems.map((n) => {
                    const signals = rowSignals(n)
                    return (
                      <tr key={n.id} className="odd:bg-[hsl(var(--card))] even:bg-[hsl(var(--bg))] align-top">
                        <td className="border-t border-[hsl(var(--border))] p-3">
                          {!isSentView && (
                            <input
                              type="checkbox"
                              checked={selected.has(n.id)}
                              onChange={() => toggle(n.id)}
                              aria-label="Select row"
                            />
                          )}
                        </td>
                        <td className="border-t border-[hsl(var(--border))] p-3 font-medium">{n.title || '—'}</td>
                        <td className="border-t border-[hsl(var(--border))] p-3 text-[hsl(var(--muted))]">{preview(n.body)}</td>
                        <td className="border-t border-[hsl(var(--border))] p-3">
                          <div className="flex flex-wrap gap-2">
                            <Badge>{kindLabel(n.kind)}</Badge>
                            {signals.important ? <Badge>Important</Badge> : null}
                            {signals.recent ? <Badge>Recent</Badge> : null}
                            {signals.unread ? <Badge>Unread</Badge> : null}
                          </div>
                        </td>
                        <td className="border-t border-[hsl(var(--border))] p-3">{fmtDate(n.created_at)}</td>
                        <td className="border-t border-[hsl(var(--border))] p-3">
                          {isSentView ? (
                            <div className="text-xs">
                              <div className="font-medium">{n.recipient_name || '—'}</div>
                              {n.recipient_email ? <div className="text-[hsl(var(--muted))]">{n.recipient_email}</div> : null}
                              {typeof n.recipient_count === 'number' ? (
                                <div className="text-[hsl(var(--muted))]">
                                  {n.recipient_count} recipient{n.recipient_count === 1 ? '' : 's'}
                                </div>
                              ) : null}
                            </div>
                          ) : n.read_at ? (
                            <Badge className="bg-black text-white border-black">Read</Badge>
                          ) : (
                            <Badge>Unread</Badge>
                          )}
                        </td>
                        <td className="border-t border-[hsl(var(--border))] p-3">
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" onClick={() => openItemAndRead(n)}>
                              Open
                            </Button>
                            {!isSentView ? (
                              n.read_at ? (
                                <Button variant="outline" size="sm" onClick={async () => {
                                  const ok = await markIds([n.id], 'unread')
                                  if (ok) await load(page)
                                }}>
                                  Unread
                                </Button>
                              ) : (
                                <Button variant="outline" size="sm" onClick={async () => {
                                  const ok = await markIds([n.id], 'read')
                                  if (ok) await load(page)
                                }}>
                                  Read
                                </Button>
                              )
                            ) : null}
                            {!isSentView ? (
                              <Button variant="outline" size="sm" onClick={() => deleteOne(n.id)}>
                                Delete
                              </Button>
                            ) : isAdmin ? (
                              <Button variant="outline" size="sm" onClick={() => deleteSentOne(n)}>
                                Delete
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 md:hidden">
            {visibleItems.length === 0 ? (
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 text-[hsl(var(--muted))]">
                {isSentView ? 'No sent notifications.' : 'No inbox notifications.'}
              </div>
            ) : (
              visibleItems.map((n) => {
                const signals = rowSignals(n)
                return (
                  <div key={n.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold">{n.title || '—'}</div>
                        <div className="mt-1 text-xs text-[hsl(var(--muted))]">{fmtDate(n.created_at)}</div>
                      </div>
                      {!isSentView && (
                        <input type="checkbox" checked={selected.has(n.id)} onChange={() => toggle(n.id)} aria-label="Select" />
                      )}
                    </div>

                    <div className="mb-2 text-sm text-[hsl(var(--muted))]">{preview(n.body, 140)}</div>

                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <Badge>{kindLabel(n.kind)}</Badge>
                      {signals.important ? <Badge>Important</Badge> : null}
                      {signals.recent ? <Badge>Recent</Badge> : null}
                      {signals.unread ? <Badge>Unread</Badge> : null}
                      {!isSentView && !signals.unread ? <Badge className="bg-black text-white border-black">Read</Badge> : null}
                    </div>

                    {isSentView ? (
                      <div className="mb-3 text-sm text-[hsl(var(--muted))]">
                        Recipient: <span className="font-medium text-black">{n.recipient_name || '—'}</span>
                        {n.recipient_email ? ` · ${n.recipient_email}` : ''}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => openItemAndRead(n)}>
                        Open
                      </Button>
                      {!isSentView ? (
                        n.read_at ? (
                          <Button variant="outline" size="sm" onClick={async () => {
                            const ok = await markIds([n.id], 'unread')
                            if (ok) await load(page)
                          }}>
                            Unread
                          </Button>
                        ) : (
                          <Button variant="outline" size="sm" onClick={async () => {
                            const ok = await markIds([n.id], 'read')
                            if (ok) await load(page)
                          }}>
                            Read
                          </Button>
                        )
                      ) : null}
                      {!isSentView ? (
                        <Button variant="outline" size="sm" onClick={() => deleteOne(n.id)}>
                          Delete
                        </Button>
                      ) : isAdmin ? (
                        <Button variant="outline" size="sm" onClick={() => deleteSentOne(n)}>
                          Delete
                        </Button>
                      ) : null}
                    </div>
                  </div>
                )
              })
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
