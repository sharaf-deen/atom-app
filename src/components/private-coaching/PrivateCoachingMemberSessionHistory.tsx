'use client'

import * as React from 'react'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import {
  formatPrivateCoachingSlotTime,
  privateCoachingBookingStatusLabel,
} from '@/lib/privateCoaching'

type SessionHistoryRow = {
  id: string
  coach_name: string
  slot_date: string
  start_time: string
  end_time: string
  status: string
  completed_at: string | null
  archived_at: string | null
  technical_content_updated_at: string | null
  has_technical_content: boolean
  blocks: string[]
  techniques: Array<{ name: string; block: string | null }>
  situations: Array<{ name: string; technique: string | null }>
  session_notes: string | null
}

type HistoryResponse = {
  ok?: boolean
  sessions?: SessionHistoryRow[]
  error?: string
  details?: string
}

const FILTERS = [
  { value: 'all', label: 'All sessions' },
  { value: 'completed', label: 'Completed' },
  { value: 'booked', label: 'Upcoming' },
] as const

function formatSlotDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusClass(status: string) {
  if (status === 'completed') return 'border-blue-200 bg-blue-50 text-blue-700'
  if (status === 'booked') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

export default function PrivateCoachingMemberSessionHistory() {
  const [sessions, setSessions] = React.useState<SessionHistoryRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState('')
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]['value']>('all')
  const [expandedId, setExpandedId] = React.useState('')

  React.useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')

      try {
        const response = await fetch('/api/private-coaching/session-history', {
          method: 'GET',
          cache: 'no-store',
        })
        const json = (await response.json().catch(() => ({}))) as HistoryResponse

        if (!response.ok || !json?.ok) {
          if (!cancelled) {
            setError(json?.details || json?.error || 'Could not load your private session history.')
          }
          return
        }

        if (!cancelled) setSessions(json.sessions ?? [])
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Could not load your private session history.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const filteredSessions = React.useMemo(() => {
    if (filter === 'all') return sessions
    return sessions.filter((session) => session.status === filter)
  }, [filter, sessions])

  const completedWithContent = sessions.filter(
    (session) => session.status === 'completed' && session.has_technical_content,
  ).length

  if (loading) {
    return (
      <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-5 text-sm font-semibold shadow-soft">
        Loading your session history…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}

      {!error ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
              <div className="text-sm text-[hsl(var(--muted))]">Sessions</div>
              <div className="mt-1 text-2xl font-semibold">{sessions.length}</div>
            </div>
            <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
              <div className="text-sm text-[hsl(var(--muted))]">Completed</div>
              <div className="mt-1 text-2xl font-semibold">
                {sessions.filter((session) => session.status === 'completed').length}
              </div>
            </div>
            <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
              <div className="text-sm text-[hsl(var(--muted))]">Technical records</div>
              <div className="mt-1 text-2xl font-semibold">{completedWithContent}</div>
            </div>
          </div>

          {sessions.length ? (
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setFilter(item.value)}
                  className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                    filter === item.value
                      ? 'border-black bg-black text-white'
                      : 'border-[hsl(var(--border))] bg-white text-[hsl(var(--muted))] hover:text-[hsl(var(--fg))]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}

          {!sessions.length ? (
            <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white p-5 text-sm text-[hsl(var(--muted))]">
              Your technical session history will appear here after private coaching bookings are created.
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white p-5 text-sm text-[hsl(var(--muted))]">
              No private session matches this filter.
            </div>
          ) : (
            <div className="grid gap-3">
              {filteredSessions.map((session) => {
                const expanded = expandedId === session.id

                return (
                  <div
                    key={session.id}
                    className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(session.status)}`}>
                            {privateCoachingBookingStatusLabel(session.status)}
                          </span>
                          {session.has_technical_content ? (
                            <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700">
                              Technical content available
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-3 font-semibold tracking-tight">
                          {formatSlotDate(session.slot_date)} · {formatPrivateCoachingSlotTime(session.start_time)} - {formatPrivateCoachingSlotTime(session.end_time)}
                        </div>
                        <div className="mt-1 text-sm text-[hsl(var(--muted))]">{session.coach_name}</div>

                        {session.completed_at ? (
                          <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                            Completed {formatDateTime(session.completed_at)}
                          </div>
                        ) : null}
                      </div>

                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setExpandedId(expanded ? '' : session.id)}
                        className="w-full sm:w-auto"
                      >
                        {expanded ? 'Hide session content' : 'View session content'}
                      </Button>
                    </div>

                    {expanded ? (
                      <div className="mt-4 border-t border-[hsl(var(--border))] pt-4">
                        {!session.has_technical_content ? (
                          <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4 text-sm text-[hsl(var(--muted))]">
                            The coach has not added technical content for this session yet.
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div>
                              <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                                Blocks
                              </div>
                              {session.blocks.length ? (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {session.blocks.map((block, index) => (
                                    <span
                                      key={`${block}-${index}`}
                                      className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-1 text-sm font-semibold"
                                    >
                                      {block}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <div className="mt-1 text-sm text-[hsl(var(--muted))]">No block recorded.</div>
                              )}
                            </div>

                            <div>
                              <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                                Techniques
                              </div>
                              {session.techniques.length ? (
                                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                  {session.techniques.map((technique, index) => (
                                    <div
                                      key={`${technique.name}-${index}`}
                                      className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-2"
                                    >
                                      <div className="text-sm font-semibold">{technique.name}</div>
                                      {technique.block ? (
                                        <div className="mt-1 text-xs text-[hsl(var(--muted))]">{technique.block}</div>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="mt-1 text-sm text-[hsl(var(--muted))]">No technique recorded.</div>
                              )}
                            </div>

                            <div>
                              <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                                Situations
                              </div>
                              {session.situations.length ? (
                                <div className="mt-2 grid gap-2">
                                  {session.situations.map((situation, index) => (
                                    <div
                                      key={`${situation.name}-${index}`}
                                      className="rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2"
                                    >
                                      <div className="text-sm font-semibold">{situation.name}</div>
                                      {situation.technique ? (
                                        <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                                          Technique: {situation.technique}
                                        </div>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="mt-1 text-sm text-[hsl(var(--muted))]">No situation recorded.</div>
                              )}
                            </div>

                            <div>
                              <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                                Coach notes
                              </div>
                              {session.session_notes ? (
                                <div className="mt-2 whitespace-pre-wrap rounded-2xl border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-950">
                                  {session.session_notes}
                                </div>
                              ) : (
                                <div className="mt-1 text-sm text-[hsl(var(--muted))]">No coach notes recorded.</div>
                              )}
                            </div>

                            {session.technical_content_updated_at ? (
                              <div className="text-xs text-[hsl(var(--muted))]">
                                Technical record updated {formatDateTime(session.technical_content_updated_at)}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
