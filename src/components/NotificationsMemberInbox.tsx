'use client'

import { useEffect, useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'

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
  /** Show delete button (admin/super_admin) */
  canDelete?: boolean
}

async function safeJson(r: Response) {
  try {
    return await r.json()
  } catch {
    return {}
  }
}

export default function NotificationsMemberInbox({ canDelete = false }: Props) {
  const [q, setQ] = useState('')
  const [debQ, setDebQ] = useState('')
  const [tab, setTab] = useState<'all' | 'unread'>('all')

  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

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

      setItems(Array.isArray(j.items) ? j.items : [])
      setTotal(Number(j.total || 0))
      setPage(Number(j.page || p))
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
  }, [debQ, tab])

  useEffect(() => {
    const handler = () => load(page)
    window.addEventListener('notifications:updated', handler)
    return () => window.removeEventListener('notifications:updated', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  async function deleteOne(id: string) {
    if (!canDelete) return
    if (!confirm('Delete this message for you? This will not delete it for the member.')) return

    const r = await fetch('/api/notifications/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id], scope: 'inbox' }),
    })

    const j: any = await safeJson(r)
    if (!r.ok || !j?.ok) {
      alert(j?.details || j?.error || 'Failed to delete')
      return
    }

    window.dispatchEvent(new Event('notifications:updated'))

    const willEmpty = items.length === 1 && page > 1
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
        <CardTitle>Member Messages</CardTitle>
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

          <div className="sm:max-w-xs w-full">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search messages" />
          </div>

          <div className="sm:ml-auto flex items-center gap-2">
            <Button variant="outline" onClick={() => load(page)} disabled={loading} className="px-3 py-2">
              Reload
            </Button>
          </div>
        </div>

        {err && (
          <div className="mt-3 rounded-2xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {err}
          </div>
        )}

        <div className="mt-4">
          <div className="hidden overflow-x-auto rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-soft md:block">
            <table className="min-w-full text-sm">
              <thead className="bg-[hsl(var(--bg))] text-left">
                <tr>
                  <th className="border-b border-[hsl(var(--border))] p-3 font-medium">From</th>
                  <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Title</th>
                  <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Message</th>
                  <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Created</th>
                  <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Status</th>
                  <th className="border-b border-[hsl(var(--border))] p-3" />
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-4 text-[hsl(var(--muted))]">
                      No messages.
                    </td>
                  </tr>
                ) : (
                  items.map((m) => (
                    <tr key={m.id} className="odd:bg-[hsl(var(--card))] even:bg-[hsl(var(--bg))] align-top">
                      <td className="border-t border-[hsl(var(--border))] p-3">
                        <div className="text-xs">
                          <div className="font-medium">{m.sender_name || '—'}</div>
                          {m.sender_email ? <div className="text-[hsl(var(--muted))]">{m.sender_email}</div> : null}
                        </div>
                      </td>
                      <td className="border-t border-[hsl(var(--border))] p-3 font-medium">{m.title || '—'}</td>
                      <td className="border-t border-[hsl(var(--border))] p-3 whitespace-pre-wrap">{m.body}</td>
                      <td className="border-t border-[hsl(var(--border))] p-3">{fmtDate(m.created_at)}</td>
                      <td className="border-t border-[hsl(var(--border))] p-3">
                        {m.read_at ? <Badge className="bg-black text-white border-black">Read</Badge> : <Badge>Unread</Badge>}
                      </td>
                      <td className="border-t border-[hsl(var(--border))] p-3">
                        {canDelete ? (
                          <Button variant="outline" size="sm" onClick={() => deleteOne(m.id)}>
                            Delete
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {items.length === 0 ? (
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 text-[hsl(var(--muted))]">
                No messages.
              </div>
            ) : (
              items.map((m) => (
                <div key={m.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
                  <div className="mb-1 text-xs">
                    <span className="text-[hsl(var(--muted))]">From:</span> <span className="font-medium">{m.sender_name || '—'}</span>
                    {m.sender_email ? <span className="text-[hsl(var(--muted))]"> · {m.sender_email}</span> : null}
                  </div>

                  <div className="mb-2 font-semibold">{m.title || '—'}</div>
                  <div className="mb-2 whitespace-pre-wrap text-sm">{m.body}</div>

                  <div className="mb-2 text-sm">
                    <span className="text-[hsl(var(--muted))]">Created:</span> {fmtDate(m.created_at)}
                  </div>

                  <div className="mb-3">
                    {m.read_at ? <Badge className="bg-black text-white border-black">Read</Badge> : <Badge>Unread</Badge>}
                  </div>

                  {canDelete ? (
                    <Button variant="outline" size="sm" onClick={() => deleteOne(m.id)}>
                      Delete
                    </Button>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>

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
      </CardContent>
    </Card>
  )
}
