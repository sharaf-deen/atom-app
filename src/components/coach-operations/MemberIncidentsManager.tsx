'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

type MemberSearchItem = {
  userId: string
  memberId: string | null
  name: string
}

type Incident = {
  id: string
  member_id: string
  member_name_snapshot: string
  member_code_snapshot: string | null
  training_log_id: string | null
  training_group_snapshot: string | null
  training_date_snapshot: string | null
  category: 'behaviour' | 'safety' | 'injury' | 'repeated_lateness' | 'disrespect' | 'other'
  severity: 'low' | 'medium' | 'high'
  description: string
  status: 'open' | 'resolved'
  reporter_name_snapshot: string
  reporter_role_snapshot: string
  reported_at: string
  resolved_at: string | null
  resolution_note: string | null
  reopened_at: string | null
}

type TrainingLog = {
  id: string
  target_group_snapshot: string
  training_date: string
  session_time: string
  coach_name_snapshot: string
}

const CATEGORY_LABELS: Record<Incident['category'], string> = {
  behaviour: 'Behaviour',
  safety: 'Safety',
  injury: 'Injury',
  repeated_lateness: 'Repeated lateness',
  disrespect: 'Disrespect',
  other: 'Other',
}

function fmtDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function fmtDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

function normalizeTime(value?: string | null) {
  const raw = String(value ?? '')
  return raw.match(/^\d{2}:\d{2}/)?.[0] ?? raw
}

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'warning' | 'danger' | 'success' }) {
  const cls =
    tone === 'danger'
      ? 'border-rose-200 bg-rose-50 text-rose-800'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : tone === 'success'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
          : 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-[hsl(var(--fg))]'

  return <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`}>{children}</span>
}

export default function MemberIncidentsManager({
  canCreate,
  canManage,
  incidents,
  trainingLogs,
}: {
  canCreate: boolean
  canManage: boolean
  incidents: Incident[]
  trainingLogs: TrainingLog[]
}) {
  const router = useRouter()
  const [showCreate, setShowCreate] = useState(false)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<MemberSearchItem[]>([])
  const [selectedMember, setSelectedMember] = useState<MemberSearchItem | null>(null)
  const [trainingLogId, setTrainingLogId] = useState('')
  const [category, setCategory] = useState<Incident['category']>('behaviour')
  const [severity, setSeverity] = useState<Incident['severity']>('low')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'resolved'>('all')
  const [severityFilter, setSeverityFilter] = useState<'all' | Incident['severity']>('all')

  const visible = useMemo(
    () =>
      incidents.filter((item) => {
        if (statusFilter !== 'all' && item.status !== statusFilter) return false
        if (severityFilter !== 'all' && item.severity !== severityFilter) return false
        return true
      }),
    [incidents, severityFilter, statusFilter],
  )

  async function searchMembers() {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      return
    }
    setSearching(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/coach-operations/incidents?action=members&q=${encodeURIComponent(q)}`, {
        cache: 'no-store',
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.details || payload?.error || 'Member search failed.')
      }
      setResults(Array.isArray(payload.items) ? payload.items : [])
    } catch (error: any) {
      setMessage(error?.message || 'Member search failed.')
    } finally {
      setSearching(false)
    }
  }

  async function createIncident() {
    if (!selectedMember) {
      setMessage('Select the member involved.')
      return
    }
    if (description.trim().length < 5) {
      setMessage('Describe what happened.')
      return
    }

    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/coach-operations/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'create',
          memberId: selectedMember.userId,
          trainingLogId: trainingLogId || null,
          category,
          severity,
          description,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.details || payload?.error || 'Could not save incident.')
      }

      setShowCreate(false)
      setSelectedMember(null)
      setQuery('')
      setResults([])
      setTrainingLogId('')
      setCategory('behaviour')
      setSeverity('low')
      setDescription('')
      setMessage('Incident recorded.')
      router.refresh()
    } catch (error: any) {
      setMessage(error?.message || 'Could not save incident.')
    } finally {
      setBusy(false)
    }
  }

  async function resolveIncident(id: string) {
    const resolutionNote = window.prompt('Resolution / follow-up note (optional):') ?? ''
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/coach-operations/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'resolve', id, resolutionNote }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.ok) throw new Error(payload?.details || payload?.error || 'Could not resolve incident.')
      router.refresh()
    } catch (error: any) {
      setMessage(error?.message || 'Could not resolve incident.')
    } finally {
      setBusy(false)
    }
  }

  async function reopenIncident(id: string) {
    if (!window.confirm('Reopen this incident? The previous resolution remains auditable by timestamps.')) return
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/coach-operations/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'reopen', id }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.ok) throw new Error(payload?.details || payload?.error || 'Could not reopen incident.')
      router.refresh()
    } catch (error: any) {
      setMessage(error?.message || 'Could not reopen incident.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Incident register</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              Report factual internal incidents. Records are preserved; they are not shown to members or guardians.
            </p>
          </div>
          {canCreate ? (
            <button
              type="button"
              onClick={() => setShowCreate((value) => !value)}
              className="rounded-2xl bg-black px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
              disabled={busy}
            >
              {showCreate ? 'Close' : 'Report incident'}
            </button>
          ) : null}
        </div>

        {message ? (
          <div className="mt-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm">
            {message}
          </div>
        ) : null}

        {showCreate ? (
          <div className="mt-4 space-y-4 border-t border-[hsl(var(--border))] pt-4">
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Member</label>
              {selectedMember ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[hsl(var(--border))] p-3">
                  <div>
                    <div className="font-medium">{selectedMember.name}</div>
                    <div className="text-xs text-[hsl(var(--muted))]">{selectedMember.memberId || 'No Member ID'}</div>
                  </div>
                  <button type="button" className="text-sm underline" onClick={() => setSelectedMember(null)}>
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void searchMembers()
                        }
                      }}
                      placeholder="Name or Member ID"
                      className="min-w-0 flex-1 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => void searchMembers()}
                      disabled={searching || query.trim().length < 2}
                      className="rounded-2xl border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-medium disabled:opacity-50"
                    >
                      {searching ? 'Searching…' : 'Search'}
                    </button>
                  </div>
                  {results.length ? (
                    <div className="mt-2 overflow-hidden rounded-2xl border border-[hsl(var(--border))]">
                      {results.map((item) => (
                        <button
                          key={item.userId}
                          type="button"
                          onClick={() => {
                            setSelectedMember(item)
                            setResults([])
                          }}
                          className="flex w-full items-center justify-between gap-3 border-b border-[hsl(var(--border))] px-3 py-3 text-left last:border-b-0 hover:bg-[hsl(var(--bg))]"
                        >
                          <span className="font-medium">{item.name}</span>
                          <span className="text-xs text-[hsl(var(--muted))]">{item.memberId || '—'}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </div>

            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">
                Training log · optional
              </label>
              <select
                value={trainingLogId}
                onChange={(event) => setTrainingLogId(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
              >
                <option value="">Not linked to a training log</option>
                {trainingLogs.map((log) => (
                  <option key={log.id} value={log.id}>
                    {fmtDate(log.training_date)} · {normalizeTime(log.session_time)} · {log.target_group_snapshot} · {log.coach_name_snapshot}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Category</label>
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value as Incident['category'])}
                  className="mt-2 w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
                >
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Severity</label>
                <select
                  value={severity}
                  onChange={(event) => setSeverity(event.target.value as Incident['severity'])}
                  className="mt-2 w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Description</label>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={5}
                maxLength={3000}
                placeholder="Describe the facts, context and action taken during the training."
                className="mt-2 w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2.5 text-sm"
              />
            </div>

            <button
              type="button"
              onClick={() => void createIncident()}
              disabled={busy || !selectedMember || description.trim().length < 5}
              className="rounded-2xl bg-black px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save incident'}
            </button>
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">History</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">{visible.length} incident(s) shown.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
              className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm"
            >
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
            </select>
            <select
              value={severityFilter}
              onChange={(event) => setSeverityFilter(event.target.value as typeof severityFilter)}
              className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm"
            >
              <option value="all">All severity</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-6 text-center text-sm text-[hsl(var(--muted))]">
            No incidents for this filter.
          </div>
        ) : (
          <div className="mt-4 grid gap-3">
            {visible.map((incident) => (
              <div key={incident.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={incident.status === 'resolved' ? 'success' : 'warning'}>
                        {incident.status === 'resolved' ? 'Resolved' : 'Open'}
                      </Badge>
                      <Badge tone={incident.severity === 'high' ? 'danger' : incident.severity === 'medium' ? 'warning' : 'neutral'}>
                        {incident.severity.charAt(0).toUpperCase() + incident.severity.slice(1)}
                      </Badge>
                      <Badge>{CATEGORY_LABELS[incident.category]}</Badge>
                    </div>
                    <Link href={`/members/${incident.member_id}`} className="mt-3 block font-semibold hover:underline">
                      {incident.member_name_snapshot}
                    </Link>
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                      {incident.member_code_snapshot || 'No Member ID'} · Reported {fmtDateTime(incident.reported_at)} by {incident.reporter_name_snapshot}
                    </div>
                  </div>

                  {canManage ? (
                    incident.status === 'open' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void resolveIncident(incident.id)}
                        className="rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-sm font-medium disabled:opacity-50"
                      >
                        Resolve
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void reopenIncident(incident.id)}
                        className="rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-sm font-medium disabled:opacity-50"
                      >
                        Reopen
                      </button>
                    )
                  ) : null}
                </div>

                <div className="mt-3 whitespace-pre-wrap text-sm">{incident.description}</div>

                {incident.training_log_id ? (
                  <div className="mt-3 rounded-xl bg-[hsl(var(--bg))] px-3 py-2 text-xs text-[hsl(var(--muted))]">
                    Training: {incident.training_group_snapshot || 'Training session'} · {fmtDate(incident.training_date_snapshot)}
                  </div>
                ) : null}

                {incident.status === 'resolved' ? (
                  <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                    Resolved {fmtDateTime(incident.resolved_at)}
                    {incident.resolution_note ? <div className="mt-1 whitespace-pre-wrap">{incident.resolution_note}</div> : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
