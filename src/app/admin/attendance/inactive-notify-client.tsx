'use client'

// src/app/admin/attendance/inactive-notify-client.tsx

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import Select from '@/components/ui/Select'
import Input from '@/components/ui/Input'
import InlineAlert from '@/components/ui/InlineAlert'
import { Table } from '@/components/ui/Table'

type MemberRow = {
  member_id: string
  name: string
  email: string | null
  phone: string | null
  member_code: string | null
}

type TemplateKey = 'reminder' | 'offer'

function defaultTitle(tpl: TemplateKey) {
  return tpl === 'offer' ? 'Special offer from ATOM' : 'We miss you at ATOM'
}

function defaultBody(tpl: TemplateKey, inactiveDays: number) {
  if (tpl === 'offer') {
    return `Hi! We noticed you haven’t trained in a while. We’d love to see you back at ATOM. Please contact reception today for a special offer.`
  }
  return `Hi! We noticed you haven’t checked in for about ${inactiveDays} days. We miss you at ATOM — come train this week!`
}

export default function InactiveNotifyClient({
  members,
  inactiveDays,
}: {
  members: MemberRow[]
  inactiveDays: number
}) {
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [template, setTemplate] = useState<TemplateKey>('reminder')
  const [customTitle, setCustomTitle] = useState('')
  const [customBody, setCustomBody] = useState('')
  const [loading, setLoading] = useState(false)

  const ids = useMemo(() => members.map((m) => m.member_id), [members])
  const selectedIds = useMemo(() => ids.filter((id) => selected[id]), [ids, selected])
  const allSelected = useMemo(() => selectedIds.length > 0 && selectedIds.length === ids.length, [selectedIds, ids])

  function toggle(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }))
  }
  function selectAll() {
    const next: Record<string, boolean> = {}
    for (const id of ids) next[id] = true
    setSelected(next)
  }
  function clearAll() {
    setSelected({})
  }

  async function send(toIds: string[]) {
    if (loading) return
    if (!toIds.length) {
      toast.message('Select at least one member')
      return
    }

    setLoading(true)
    try {
      const title = (customTitle || '').trim() || defaultTitle(template)
      const body = (customBody || '').trim() || defaultBody(template, inactiveDays)

      const res = await fetch('/api/admin/attendance/inactive/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cache-control': 'no-store' },
        body: JSON.stringify({ member_ids: toIds, template, title, body }),
      })

      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        toast.error(json?.details || json?.error || 'Notify failed')
        return
      }

      const sent = Number(json?.sent ?? 0)
      const skipped = Number(json?.skipped ?? 0)
      toast.success(`Sent: ${sent}` + (skipped ? ` · Skipped (already today): ${skipped}` : ''))
    } catch (e: any) {
      toast.error(e?.message ?? 'Notify failed')
    } finally {
      setLoading(false)
    }
  }

  const cols = [
    { key: 'select', header: 'Select' },
    { key: 'member', header: 'Member' },
    { key: 'contact', header: 'Contact' },
    { key: 'actions', header: '' },
  ]

  const rows = members.map((m) => {
    const checked = !!selected[m.member_id]
    const code = m.member_code ? ` (${m.member_code})` : ''
    const contact = [m.email || '', m.phone || ''].filter(Boolean).join(' · ') || '—'

    return {
      id: m.member_id,
      select: (
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-[hsl(var(--border))]"
          checked={checked}
          onChange={() => toggle(m.member_id)}
        />
      ),
      member: (
        <div className="space-y-0.5">
          <div className="font-medium">
            {m.name}
            {code}
          </div>
          {m.email ? <div className="text-xs text-[hsl(var(--muted))]">{m.email}</div> : null}
        </div>
      ),
      contact: <span className="text-sm text-[hsl(var(--muted))]">{contact}</span>,
      actions: (
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => send([m.member_id])} disabled={loading}>
            Notify
          </Button>
          <Link className="underline" href={`/members/${m.member_id}`}>
            Open
          </Link>
        </div>
      ),
    }
  })

  if (!members.length) {
    return <InlineAlert variant="info">No inactive members found for this threshold.</InlineAlert>
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full md:w-52">
            <Select
              label="Template"
              value={template}
              onChange={(e) => setTemplate((e.target.value as TemplateKey) || 'reminder')}
            >
              <option value="reminder">Reminder</option>
              <option value="offer">Offer</option>
            </Select>
          </div>

          <div className="w-full md:w-64">
            <label className="block text-xs font-medium text-[hsl(var(--muted))] mb-1">Custom title (optional)</label>
            <Input
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder={defaultTitle(template)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={selectAll} disabled={loading || allSelected}>
            Select all
          </Button>
          <Button variant="outline" size="sm" onClick={clearAll} disabled={loading}>
            Clear
          </Button>
          <Button size="sm" onClick={() => send(selectedIds)} disabled={loading || !selectedIds.length}>
            {loading ? 'Sending…' : `Notify selected (${selectedIds.length})`}
          </Button>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-[hsl(var(--muted))] mb-1">Custom message (optional)</label>
        <textarea
          className="w-full min-h-[84px] rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]"
          value={customBody}
          onChange={(e) => setCustomBody(e.target.value)}
          placeholder={defaultBody(template, inactiveDays)}
        />
        <div className="mt-1 text-[11px] text-[hsl(var(--muted))]">Tip: leave empty to use the default message.</div>
      </div>

      <Table columns={cols} rows={rows} keyField="id" />
    </div>
  )
}
