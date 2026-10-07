'use client'

import * as React from 'react'
import Button from '@/components/ui/Button'
import InlineAlert from '@/components/ui/InlineAlert'
import { formatPrivateCoachingSlotTime, privateCoachingBookingStatusLabel } from '@/lib/privateCoaching'

type BookingRow = {
  id: string
  memberName: string
  memberMeta: string
  coachName: string
  slotDate: string
  startTime: string
  endTime: string
  status: string
  archivedAt: string | null
}

type CurriculumType = {
  id: string
  name: string
  sort_order: number
}

type CurriculumBlock = {
  id: string
  type_id: string
  name: string
  sort_order: number
}

type CurriculumTechnique = {
  id: string
  block_id: string
  name: string
  technical_level: string | null
  training_format: string | null
  sort_order: number
}

type CurriculumSituation = {
  id: string
  technique_id: string
  name: string
  opponent_reaction: string | null
  coaching_response: string | null
  training_format: string | null
  sort_order: number
}

type SessionPayload = {
  ok: boolean
  read_only: boolean
  booking_status: string
  content: {
    session_notes: string
    updated_at: string | null
    block_ids: string[]
    technique_ids: string[]
    situation_ids: string[]
    snapshots: {
      blocks: Array<{ block_id: string | null; block_name_snapshot: string }>
      techniques: Array<{ technique_id: string | null; technique_name_snapshot: string; block_name_snapshot: string | null }>
      situations: Array<{ situation_id: string | null; situation_name_snapshot: string; technique_name_snapshot: string | null }>
    }
  }
  library: {
    types: CurriculumType[]
    blocks: CurriculumBlock[]
    techniques: CurriculumTechnique[]
    situations: CurriculumSituation[]
  }
  error?: string
  details?: string
}

type Props = {
  rows: BookingRow[]
}

function formatSlotDate(value: string) {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })
}

function toggleValue(values: string[], id: string, checked: boolean) {
  return checked ? Array.from(new Set([...values, id])) : values.filter((value) => value !== id)
}

export default function PrivateCoachingSessionContentClient({ rows }: Props) {
  const [selectedBookingId, setSelectedBookingId] = React.useState('')
  const [payload, setPayload] = React.useState<SessionPayload | null>(null)
  const [blockIds, setBlockIds] = React.useState<string[]>([])
  const [techniqueIds, setTechniqueIds] = React.useState<string[]>([])
  const [situationIds, setSituationIds] = React.useState<string[]>([])
  const [sessionNotes, setSessionNotes] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [status, setStatus] = React.useState<{ kind: 'success' | 'error' | ''; message: string }>({ kind: '', message: '' })

  const selectedBooking = rows.find((row) => row.id === selectedBookingId) ?? null

  const loadBooking = React.useCallback(async (bookingId: string) => {
    if (!bookingId) {
      setPayload(null)
      return
    }

    setLoading(true)
    setStatus({ kind: '', message: '' })
    try {
      const response = await fetch(`/api/private-coaching/bookings/${encodeURIComponent(bookingId)}/session-content`, {
        method: 'GET',
        cache: 'no-store',
      })
      const json = (await response.json().catch(() => ({}))) as SessionPayload
      if (!response.ok || !json?.ok) {
        setPayload(null)
        setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not load session content.' })
        return
      }

      setPayload(json)
      setBlockIds(json.content.block_ids ?? [])
      setTechniqueIds(json.content.technique_ids ?? [])
      setSituationIds(json.content.situation_ids ?? [])
      setSessionNotes(json.content.session_notes ?? '')
    } catch (error: any) {
      setPayload(null)
      setStatus({ kind: 'error', message: error?.message || 'Could not load session content.' })
    } finally {
      setLoading(false)
    }
  }, [])

  function chooseBooking(bookingId: string) {
    setSelectedBookingId(bookingId)
    setSearch('')
    void loadBooking(bookingId)
  }

  function setBlockChecked(blockId: string, checked: boolean) {
    if (!payload) return
    const techniqueIdsInBlock = new Set(
      payload.library.techniques.filter((technique) => technique.block_id === blockId).map((technique) => technique.id),
    )
    const situationIdsInBlock = new Set(
      payload.library.situations
        .filter((situation) => techniqueIdsInBlock.has(situation.technique_id))
        .map((situation) => situation.id),
    )

    setBlockIds((current) => toggleValue(current, blockId, checked))
    if (!checked) {
      setTechniqueIds((current) => current.filter((id) => !techniqueIdsInBlock.has(id)))
      setSituationIds((current) => current.filter((id) => !situationIdsInBlock.has(id)))
    }
  }

  function setTechniqueChecked(technique: CurriculumTechnique, checked: boolean) {
    if (!payload) return
    const situationsForTechnique = new Set(
      payload.library.situations.filter((situation) => situation.technique_id === technique.id).map((situation) => situation.id),
    )

    if (checked && !blockIds.includes(technique.block_id)) {
      setBlockIds((current) => Array.from(new Set([...current, technique.block_id])))
    }

    setTechniqueIds((current) => toggleValue(current, technique.id, checked))
    if (!checked) {
      setSituationIds((current) => current.filter((id) => !situationsForTechnique.has(id)))
    }
  }

  function setSituationChecked(situation: CurriculumSituation, checked: boolean) {
    if (!payload) return
    const technique = payload.library.techniques.find((row) => row.id === situation.technique_id)
    if (checked && technique) {
      setTechniqueIds((current) => Array.from(new Set([...current, technique.id])))
      setBlockIds((current) => Array.from(new Set([...current, technique.block_id])))
    }
    setSituationIds((current) => toggleValue(current, situation.id, checked))
  }

  async function save() {
    if (!selectedBookingId || !payload || payload.read_only) return

    setSaving(true)
    setStatus({ kind: '', message: '' })
    try {
      const response = await fetch(`/api/private-coaching/bookings/${encodeURIComponent(selectedBookingId)}/session-content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          block_ids: blockIds,
          technique_ids: techniqueIds,
          situation_ids: situationIds,
          session_notes: sessionNotes,
        }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok || !json?.ok) {
        setStatus({ kind: 'error', message: json?.details || json?.error || 'Could not save session content.' })
        return
      }
      setStatus({ kind: 'success', message: 'Session technical content saved.' })
      await loadBooking(selectedBookingId)
    } catch (error: any) {
      setStatus({ kind: 'error', message: error?.message || 'Could not save session content.' })
    } finally {
      setSaving(false)
    }
  }

  const normalizedSearch = search.trim().toLowerCase()
  const blocks = payload?.library.blocks ?? []
  const types = payload?.library.types ?? []
  const techniques = payload?.library.techniques ?? []
  const situations = payload?.library.situations ?? []

  const visibleBlocks = blocks.filter((block) => {
    if (!normalizedSearch) return true
    if (block.name.toLowerCase().includes(normalizedSearch)) return true
    return techniques.some(
      (technique) =>
        technique.block_id === block.id &&
        (technique.name.toLowerCase().includes(normalizedSearch) ||
          situations.some(
            (situation) =>
              situation.technique_id === technique.id &&
              (situation.name.toLowerCase().includes(normalizedSearch) ||
                String(situation.opponent_reaction ?? '').toLowerCase().includes(normalizedSearch)),
          )),
    )
  })

  return (
    <div className="space-y-4">
      {status.message ? <InlineAlert variant={status.kind === 'error' ? 'error' : 'success'}>{status.message}</InlineAlert> : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <label className="grid gap-1">
          <span className="text-sm font-semibold">Private session</span>
          <select
            value={selectedBookingId}
            onChange={(event) => chooseBooking(event.target.value)}
            className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black"
          >
            <option value="">Select a booking</option>
            {rows.map((row) => (
              <option key={row.id} value={row.id}>
                {formatSlotDate(row.slotDate)} · {formatPrivateCoachingSlotTime(row.startTime)} · {row.memberName} · {privateCoachingBookingStatusLabel(row.status)}
                {row.archivedAt ? ' · Archived' : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1">
          <span className="text-sm font-semibold">Search curriculum</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Block, technique or situation"
            disabled={!payload || loading}
            className="min-h-11 rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm shadow-soft outline-none focus:border-black disabled:opacity-50"
          />
        </label>
      </div>

      {!selectedBookingId ? (
        <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white p-5 text-sm text-[hsl(var(--muted))]">
          Select a private coaching booking to define the technical content of that session.
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-5 text-sm font-semibold">
          Loading session content…
        </div>
      ) : null}

      {payload && selectedBooking ? (
        <>
          <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-base font-semibold">{selectedBooking.memberName}</div>
              <span className="rounded-full border border-[hsl(var(--border))] px-2.5 py-1 text-[11px] font-semibold">
                {privateCoachingBookingStatusLabel(selectedBooking.status)}
              </span>
              {payload.read_only ? (
                <span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                  Archived · read-only
                </span>
              ) : null}
            </div>
            <div className="mt-1 text-sm text-[hsl(var(--muted))]">
              {formatSlotDate(selectedBooking.slotDate)} · {formatPrivateCoachingSlotTime(selectedBooking.startTime)} - {formatPrivateCoachingSlotTime(selectedBooking.endTime)} · {selectedBooking.coachName}
            </div>
            <div className="mt-3 text-sm">
              <span className="font-semibold">{blockIds.length}</span> block(s) ·{' '}
              <span className="font-semibold">{techniqueIds.length}</span> technique(s) ·{' '}
              <span className="font-semibold">{situationIds.length}</span> situation(s)
            </div>
          </div>

          {payload.read_only ? (
            <InlineAlert variant="info">
              This booking is archived. Its technical content is preserved and read-only. Restore the booking to edit it.
            </InlineAlert>
          ) : payload.booking_status === 'cancelled' ? (
            <InlineAlert variant="info">Cancelled bookings cannot receive new technical session content.</InlineAlert>
          ) : null}

          <div className="space-y-3">
            {types.map((type) => {
              const typeBlocks = visibleBlocks.filter((block) => block.type_id === type.id)
              if (!typeBlocks.length) return null

              return (
                <div key={type.id} className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                  <div className="text-base font-semibold">{type.name}</div>

                  <div className="mt-3 space-y-3">
                    {typeBlocks.map((block) => {
                      const blockTechniques = techniques.filter((technique) => technique.block_id === block.id)
                      const blockChecked = blockIds.includes(block.id)

                      return (
                        <div key={block.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-3">
                          <label className="flex cursor-pointer items-start gap-3">
                            <input
                              type="checkbox"
                              checked={blockChecked}
                              disabled={payload.read_only || payload.booking_status === 'cancelled'}
                              onChange={(event) => setBlockChecked(block.id, event.target.checked)}
                              className="mt-1 h-4 w-4"
                            />
                            <span>
                              <span className="font-semibold">{block.name}</span>
                              <span className="ml-2 text-xs text-[hsl(var(--muted))]">Block</span>
                            </span>
                          </label>

                          {(blockChecked || normalizedSearch) && blockTechniques.length ? (
                            <div className="mt-3 space-y-2 pl-3 sm:pl-7">
                              {blockTechniques.map((technique) => {
                                const techniqueChecked = techniqueIds.includes(technique.id)
                                const techniqueSituations = situations.filter((situation) => situation.technique_id === technique.id)

                                return (
                                  <div key={technique.id} className="rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
                                    <label className="flex cursor-pointer items-start gap-3">
                                      <input
                                        type="checkbox"
                                        checked={techniqueChecked}
                                        disabled={payload.read_only || payload.booking_status === 'cancelled'}
                                        onChange={(event) => setTechniqueChecked(technique, event.target.checked)}
                                        className="mt-1 h-4 w-4"
                                      />
                                      <span className="min-w-0">
                                        <span className="font-semibold">{technique.name}</span>
                                        <span className="ml-2 text-xs text-[hsl(var(--muted))]">
                                          {[technique.technical_level, technique.training_format].filter(Boolean).join(' · ')}
                                        </span>
                                      </span>
                                    </label>

                                    {(techniqueChecked || normalizedSearch) && techniqueSituations.length ? (
                                      <div className="mt-3 space-y-2 pl-3 sm:pl-7">
                                        {techniqueSituations.map((situation) => (
                                          <label key={situation.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-2">
                                            <input
                                              type="checkbox"
                                              checked={situationIds.includes(situation.id)}
                                              disabled={payload.read_only || payload.booking_status === 'cancelled'}
                                              onChange={(event) => setSituationChecked(situation, event.target.checked)}
                                              className="mt-1 h-4 w-4"
                                            />
                                            <span className="min-w-0">
                                              <span className="block text-sm font-semibold">{situation.name}</span>
                                              {situation.opponent_reaction ? (
                                                <span className="mt-1 block text-xs text-[hsl(var(--muted))]">
                                                  Reaction: {situation.opponent_reaction}
                                                </span>
                                              ) : null}
                                              {situation.coaching_response ? (
                                                <span className="mt-1 block text-xs text-[hsl(var(--muted))]">
                                                  Response: {situation.coaching_response}
                                                </span>
                                              ) : null}
                                            </span>
                                          </label>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                )
                              })}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          <label className="grid gap-1">
            <span className="text-sm font-semibold">Session notes</span>
            <textarea
              value={sessionNotes}
              onChange={(event) => setSessionNotes(event.target.value)}
              maxLength={3000}
              rows={5}
              disabled={payload.read_only || payload.booking_status === 'cancelled'}
              placeholder="Technical focus, corrections, progress, homework or next-session priorities."
              className="rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-3 text-sm shadow-soft outline-none focus:border-black disabled:opacity-60"
            />
            <span className="text-xs text-[hsl(var(--muted))]">{sessionNotes.length}/3000</span>
          </label>

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={save}
              disabled={saving || payload.read_only || payload.booking_status === 'cancelled'}
              loading={saving}
              loadingText="Saving…"
            >
              Save session content
            </Button>
          </div>
        </>
      ) : null}
    </div>
  )
}
