'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CalendarDays, Clock3, Layers3, MapPin, RefreshCw } from 'lucide-react'
import type { ScheduleTrainingSession } from '@/app/schedule/sessions/page'
import Button from '@/components/ui/Button'
import ConfirmActionModal from '@/components/ui/ConfirmActionModal'
import Input from '@/components/ui/Input'

function normalizeTime(value: string | null) {
  if (!value) return ''
  const match = value.match(/^(\d{2}):(\d{2})/)
  return match ? `${match[1]}:${match[2]}` : value
}

function formatTime(value: string | null) {
  const normalized = normalizeTime(value)
  if (!normalized) return '—'
  const [hoursRaw, minutes] = normalized.split(':')
  const hours = Number(hoursRaw)
  const suffix = hours >= 12 ? 'PM' : 'AM'
  const hour12 = hours % 12 || 12
  return `${hour12}:${minutes} ${suffix}`
}

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`)
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function formatCairoDateTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function activityLabel(value: ScheduleTrainingSession['activity_type_snapshot']) {
  const labels: Record<ScheduleTrainingSession['activity_type_snapshot'], string> = {
    jiu_jitsu: 'Jiu-Jitsu',
    competition: 'Competition',
    open_drills: 'Open Drills',
    open_mat: 'Open Mat',
    physical_preparation: 'Physical Preparation',
    wrestling: 'Wrestling',
    other: 'Other',
  }
  return labels[value]
}

function uniformLabel(value: ScheduleTrainingSession['uniform_snapshot']) {
  const labels: Record<ScheduleTrainingSession['uniform_snapshot'], string> = {
    gi: 'Gi',
    nogi: 'NoGi',
    gi_nogi: 'Gi & NoGi',
    none: 'Not specified',
  }
  return labels[value]
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => null)
  return data && typeof data === 'object' ? (data as Record<string, any>) : {}
}

export default function TrainingSessionsManager({
  canManage,
  sessions,
  today,
  previewUntil,
  defaultSyncUntil,
}: {
  canManage: boolean
  sessions: ScheduleTrainingSession[]
  today: string
  previewUntil: string
  defaultSyncUntil: string
}) {
  const router = useRouter()
  const [fromDate, setFromDate] = React.useState(today)
  const [toDate, setToDate] = React.useState(defaultSyncUntil)
  const [pending, setPending] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const grouped = React.useMemo(() => {
    const map = new Map<string, ScheduleTrainingSession[]>()
    for (const row of sessions) {
      const current = map.get(row.session_date) ?? []
      current.push(row)
      map.set(row.session_date, current)
    }
    return Array.from(map.entries())
  }, [sessions])

  const scheduledCount = sessions.filter((row) => row.status === 'scheduled').length
  const uniqueSeries = new Set(sessions.map((row) => row.series_key_snapshot)).size

  async function syncSessions() {
    setPending(true)
    setError(null)
    setMessage(null)

    try {
      const response = await fetch('/api/schedule/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'sync',
          fromDate,
          toDate,
        }),
      })

      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        throw new Error(data.details || data.error || 'Failed to synchronize scheduled sessions.')
      }

      setMessage(
        `Session sync complete: ${data.created ?? 0} created, ${data.refreshed ?? 0} refreshed, ${data.removed ?? 0} obsolete future placeholders removed, ${data.protected ?? 0} protected.`,
      )
      setConfirmOpen(false)
      router.refresh()
    } catch (cause: any) {
      setError(String(cause?.message || cause))
      setConfirmOpen(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
            <CalendarDays className="h-4 w-4" /> Preview sessions
          </div>
          <div className="mt-1 text-2xl font-bold">{sessions.length}</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">{today} → {previewUntil}</div>
        </div>

        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
            <Layers3 className="h-4 w-4" /> Class series
          </div>
          <div className="mt-1 text-2xl font-bold">{uniqueSeries}</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">represented in the preview</div>
        </div>

        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
            <RefreshCw className="h-4 w-4" /> Scheduled
          </div>
          <div className="mt-1 text-2xl font-bold">{scheduledCount}</div>
          <div className="mt-1 text-xs text-[hsl(var(--muted))]">no coach/session links yet</div>
        </div>
      </div>

      {canManage ? (
        <div className="space-y-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft sm:p-5">
          <div>
            <h2 className="font-semibold">Generate / sync dated sessions</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              Default range is the next 90 days. Running the same range again is safe and does not create duplicate sessions.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="space-y-1.5 text-sm font-medium">
              <span>From</span>
              <Input type="date" min={today} value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
            </label>

            <label className="space-y-1.5 text-sm font-medium">
              <span>To</span>
              <Input type="date" min={fromDate || today} value={toDate} onChange={(event) => setToDate(event.target.value)} />
            </label>

            <Button
              type="button"
              onClick={() => {
                setError(null)
                setMessage(null)
                if (!fromDate || !toDate) {
                  setError('Choose both dates.')
                  return
                }
                if (toDate < fromDate) {
                  setError('The end date must be on or after the start date.')
                  return
                }
                setConfirmOpen(true)
              }}
              disabled={pending}
            >
              <RefreshCw className="h-4 w-4" />
              Sync sessions
            </Button>
          </div>

          {message ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {message}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {error}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-3">
        <div>
          <h2 className="font-semibold">Upcoming session preview</h2>
          <p className="text-sm text-[hsl(var(--muted))]">Next 14 calendar days only. Synchronization can generate a longer future window.</p>
        </div>

        {grouped.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] p-6 text-center text-sm text-[hsl(var(--muted))]">
            No dated sessions have been generated for this preview window yet. Use <strong>Sync sessions</strong> above.
          </div>
        ) : (
          grouped.map(([date, rows]) => (
            <section key={date} className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-soft">
              <div className="border-b border-[hsl(var(--border))] px-4 py-3">
                <h3 className="font-semibold">{formatDate(date)}</h3>
                <p className="text-xs text-[hsl(var(--muted))]">{rows.length} scheduled class{rows.length === 1 ? '' : 'es'}</p>
              </div>

              <div className="divide-y divide-[hsl(var(--border))]">
                {rows.map((row) => (
                  <article key={row.id} className="space-y-2 px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold">{row.name_snapshot}</div>
                        <div className="mt-0.5 text-sm text-[hsl(var(--muted))]">
                          {row.level_snapshot} · {activityLabel(row.activity_type_snapshot)} · {uniformLabel(row.uniform_snapshot)}
                        </div>
                      </div>

                      <span className="rounded-full border border-[hsl(var(--border))] px-2.5 py-1 text-xs font-semibold uppercase tracking-wide">
                        {row.status}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock3 className="h-4 w-4 text-[hsl(var(--muted))]" />
                        {formatTime(row.start_time)}
                        {row.end_time ? ` – ${formatTime(row.end_time)}` : ''}
                      </span>

                      {row.mat_snapshot ? (
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="h-4 w-4 text-[hsl(var(--muted))]" />
                          {row.mat_snapshot}
                        </span>
                      ) : null}
                    </div>

                    <div className="text-xs text-[hsl(var(--muted))]">
                      {row.template_managed ? 'Template-managed' : 'Exception-locked'} · last sync {formatCairoDateTime(row.synced_at)}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      <ConfirmActionModal
        open={confirmOpen}
        onCancel={() => !pending && setConfirmOpen(false)}
        onConfirm={syncSessions}
        pending={pending}
        pendingLabel="Synchronizing…"
        title="Synchronize dated sessions?"
        description={`Sync ${fromDate || '—'} through ${toDate || '—'} from the active Class Templates. Existing future template-managed scheduled rows may be refreshed or removed if the recurring template changed.`}
        confirmLabel="Sync sessions"
        summaryItems={[
          { label: 'From', value: fromDate || '—' },
          { label: 'To', value: toDate || '—' },
          { label: 'Source', value: 'Active Class Templates' },
        ]}
        warning="Past, completed, cancelled and future exception-locked sessions are not rewritten by this synchronization."
      />
    </div>
  )
}
