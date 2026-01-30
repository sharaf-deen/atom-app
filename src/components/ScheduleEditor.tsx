'use client'

import { useEffect, useMemo, useState, type ReactElement } from 'react'
import Button from '@/components/ui/Button'

type Props = {
  initialContent: string
  canEdit: boolean
  updatedAt?: string | null
}

const DAY_NAMES = new Set(['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])
const TOP_HEADINGS = new Set(['Kids & Teens','Adults','Weekly Schedule by Day'])

function hasDigit(s: string) {
  return /\d/.test(s)
}

function renderLines(text: string) {
  const lines = text.split(/\r?\n/)
  const out: ReactElement[] = []
  let key = 0

  for (const raw of lines) {
    const line = raw.trimEnd()
    const t = line.trim()

    if (!t) {
      out.push(<div key={key++} className="h-3" />)
      continue
    }

    const isTop = TOP_HEADINGS.has(t)
    const isDay = DAY_NAMES.has(t)
    const isMeta = t.includes('·') && !hasDigit(t)
    const isSub =
      !hasDigit(t) &&
      !t.includes('–') &&
      !t.includes(':') &&
      !isTop &&
      !isDay &&
      t.length <= 40

    if (isTop) {
      out.push(<h2 key={key++} className="mt-6 text-xl font-semibold tracking-tight">{t}</h2>)
      continue
    }
    if (isDay) {
      out.push(<h3 key={key++} className="mt-6 text-lg font-semibold tracking-tight">{t}</h3>)
      continue
    }
    if (isSub) {
      out.push(<div key={key++} className="mt-4 text-base font-semibold">{t}</div>)
      continue
    }
    if (isMeta) {
      out.push(<div key={key++} className="text-sm font-medium text-[hsl(var(--muted))]">{t}</div>)
      continue
    }

    out.push(<div key={key++} className="text-[15px] leading-6">{t}</div>)
  }

  return out
}

function splitByMarker(content: string) {
  const marker = 'Weekly Schedule by Day'
  const idx = content.indexOf(marker)
  if (idx < 0) return { a: content, b: '' }
  const a = content.slice(0, idx).trim()
  const b = content.slice(idx).trim()
  return { a, b }
}

export default function ScheduleEditor({ initialContent, canEdit, updatedAt }: Props) {
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(initialContent)
  const [draft, setDraft] = useState(initialContent)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  useEffect(() => {
    setContent(initialContent)
    setDraft(initialContent)
  }, [initialContent])

  const parts = useMemo(() => splitByMarker(content), [content])
  const [tab, setTab] = useState<'program' | 'day'>('program')

  useEffect(() => {
    if (tab === 'day' && !parts.b) setTab('program')
  }, [parts.b, tab])

  async function onSave() {
    setSaving(true)
    setError(null)
    setOk(null)
    try {
      const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.error || 'Save failed')
      setContent(draft)
      setEditing(false)
      setOk('Saved')
      window.dispatchEvent(new Event('atom:reload'))
    } catch (e: any) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
      setTimeout(() => setOk(null), 2500)
    }
  }

  function onCancel() {
    setDraft(content)
    setEditing(false)
    setError(null)
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Weekly Schedule</h2>
          </div>

          <div className="flex items-center gap-2">
            {ok ? <span className="text-sm text-emerald-600 font-medium">{ok}</span> : null}
            {canEdit && !editing ? (
              <Button variant="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : null}
            {canEdit && editing ? (
              <>
                <Button variant="outline" onClick={onCancel} disabled={saving}>
                  Cancel
                </Button>
                <Button onClick={onSave} disabled={saving || !draft.trim()}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {updatedAt ? (
          <div className="mt-3 text-xs text-[hsl(var(--muted))]">
            Last updated: {new Date(updatedAt).toLocaleString()}
          </div>
        ) : null}

        {error ? (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {editing ? (
          <div className="mt-4 space-y-2">
            <label className="text-sm font-medium">Schedule content</label>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[520px] w-full rounded-2xl border border-[hsl(var(--border))] bg-white p-3 text-sm outline-none focus:ring-2 focus:ring-black/20"
              placeholder="Paste your schedule here..."
            />
            <p className="text-xs text-[hsl(var(--muted))]">Tip: use blank lines to separate blocks.</p>
          </div>
        ) : (
          <div className="mt-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTab('program')}
                className={`rounded-full px-3 py-1 text-sm border ${
                  tab === 'program'
                    ? 'bg-black text-white border-black'
                    : 'bg-white text-black border-[hsl(var(--border))]'
                }`}
              >
                By Program
              </button>
              <button
                onClick={() => setTab('day')}
                disabled={!parts.b}
                className={`rounded-full px-3 py-1 text-sm border ${
                  tab === 'day'
                    ? 'bg-black text-white border-black'
                    : 'bg-white text-black border-[hsl(var(--border))]'
                } ${!parts.b ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                By Day
              </button>
            </div>

            <div className="mt-4">
              {tab === 'program' ? (
                <div className="space-y-0">{renderLines(parts.a)}</div>
              ) : (
                <div className="space-y-0">{renderLines(parts.b)}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}