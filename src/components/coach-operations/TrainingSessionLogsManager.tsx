'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, ChevronDown, ClipboardList, Pencil, Plus, RotateCcw } from 'lucide-react'
import Button from '@/components/ui/Button'
import ConfirmActionModal from '@/components/ui/ConfirmActionModal'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'

type Program = {
  id: string
  title: string
  target_group: string
  start_date: string
  end_date: string
  notes: string | null
  status: 'published'
}

type ProgramItem = {
  id: string
  program_id: string
  selected_level: 'block' | 'technique' | 'situation'
  type_id: string
  block_id: string
  technique_id: string | null
  situation_id: string | null
  sort_order: number
}

type CurriculumType = { id: string; name: string; sort_order: number; is_active: boolean }
type CurriculumBlock = { id: string; type_id: string; name: string; sort_order: number; is_active: boolean }
type CurriculumTechnique = { id: string; block_id: string; name: string; sort_order: number; is_active: boolean }
type CurriculumSituation = {
  id: string
  technique_id: string
  name: string
  opponent_reaction: string
  coaching_response: string | null
  sort_order: number
  is_active: boolean
}

type SessionLog = {
  id: string
  program_id: string
  program_title_snapshot: string
  target_group_snapshot: string
  training_date: string
  session_time: string
  coach_user_id: string | null
  coach_name_snapshot: string
  coach_role_snapshot: string
  notes: string | null
  status: 'draft' | 'completed'
  completed_at: string | null
  reopened_at: string | null
  created_at: string
  updated_at: string
}

type SessionLogItem = {
  id: string
  session_log_id: string
  selected_level: 'block' | 'technique' | 'situation'
  type_id: string
  block_id: string
  technique_id: string | null
  situation_id: string | null
  type_name_snapshot: string
  block_name_snapshot: string
  technique_name_snapshot: string | null
  situation_name_snapshot: string | null
  opponent_reaction_snapshot: string | null
  coaching_response_snapshot: string | null
  sort_order: number
}

function todayIso() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00`)
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function normalizeTime(value: string) {
  const match = String(value ?? '').match(/^(\d{2}):(\d{2})/)
  return match ? `${match[1]}:${match[2]}` : ''
}

function roleLabel(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => null)
  return data && typeof data === 'object' ? (data as Record<string, any>) : {}
}

export default function TrainingSessionLogsManager({
  currentUserId,
  canCreate,
  canManage,
  programs,
  programItems,
  types,
  blocks,
  techniques,
  situations,
  logs,
  logItems,
}: {
  currentUserId: string
  canCreate: boolean
  canManage: boolean
  programs: Program[]
  programItems: ProgramItem[]
  types: CurriculumType[]
  blocks: CurriculumBlock[]
  techniques: CurriculumTechnique[]
  situations: CurriculumSituation[]
  logs: SessionLog[]
  logItems: SessionLogItem[]
}) {
  const router = useRouter()
  const [formOpen, setFormOpen] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [programId, setProgramId] = React.useState('')
  const [trainingDate, setTrainingDate] = React.useState(todayIso())
  const [sessionTime, setSessionTime] = React.useState('18:00')
  const [notes, setNotes] = React.useState('')
  const [selectedBlocks, setSelectedBlocks] = React.useState<Set<string>>(new Set())
  const [selectedTechniques, setSelectedTechniques] = React.useState<Set<string>>(new Set())
  const [selectedSituations, setSelectedSituations] = React.useState<Set<string>>(new Set())
  const [expandedLogs, setExpandedLogs] = React.useState<Set<string>>(new Set())
  const [pending, setPending] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [completeConfirm, setCompleteConfirm] = React.useState(false)
  const [reopenTarget, setReopenTarget] = React.useState<SessionLog | null>(null)

  const currentProgram = programs.find((program) => program.id === programId) ?? null
  const typeMap = React.useMemo(() => new Map(types.map((row) => [row.id, row])), [types])

  function programBlockIds(id: string) {
    return new Set(programItems.filter((row) => row.program_id === id && row.selected_level === 'block').map((row) => row.block_id))
  }

  function allowedBlocks(id: string) {
    const allowed = programBlockIds(id)
    return blocks.filter((block) => allowed.has(block.id))
  }

  function allowedTechniques(id: string, blockId: string) {
    const explicitIds = new Set(
      programItems
        .filter((row) => row.program_id === id && row.selected_level === 'technique' && row.block_id === blockId && row.technique_id)
        .map((row) => row.technique_id!),
    )
    if (explicitIds.size) return techniques.filter((technique) => explicitIds.has(technique.id))
    return techniques.filter((technique) => technique.block_id === blockId && technique.is_active)
  }

  function allowedSituations(id: string, techniqueId: string) {
    const explicitIds = new Set(
      programItems
        .filter((row) => row.program_id === id && row.selected_level === 'situation' && row.technique_id === techniqueId && row.situation_id)
        .map((row) => row.situation_id!),
    )
    if (explicitIds.size) return situations.filter((situation) => explicitIds.has(situation.id))
    return situations.filter((situation) => situation.technique_id === techniqueId && situation.is_active)
  }

  function resetFeedback() {
    setMessage(null)
    setError(null)
  }

  function chooseInitialProgram() {
    const today = todayIso()
    return programs.find((program) => today >= program.start_date && today <= program.end_date) ?? programs[0] ?? null
  }

  function resetSelections() {
    setSelectedBlocks(new Set())
    setSelectedTechniques(new Set())
    setSelectedSituations(new Set())
  }

  function openNew() {
    resetFeedback()
    const program = chooseInitialProgram()
    setEditingId(null)
    setProgramId(program?.id ?? '')
    setTrainingDate(program && todayIso() >= program.start_date && todayIso() <= program.end_date ? todayIso() : program?.start_date ?? todayIso())
    setSessionTime('18:00')
    setNotes('')
    resetSelections()
    setFormOpen(true)
  }

  function openEdit(log: SessionLog) {
    resetFeedback()
    setEditingId(log.id)
    setProgramId(log.program_id)
    setTrainingDate(log.training_date)
    setSessionTime(normalizeTime(log.session_time) || '18:00')
    setNotes(log.notes ?? '')
    const items = logItems.filter((item) => item.session_log_id === log.id)
    setSelectedBlocks(new Set(items.filter((item) => item.selected_level === 'block').map((item) => item.block_id)))
    setSelectedTechniques(new Set(items.filter((item) => item.selected_level === 'technique' && item.technique_id).map((item) => item.technique_id!)))
    setSelectedSituations(new Set(items.filter((item) => item.selected_level === 'situation' && item.situation_id).map((item) => item.situation_id!)))
    setFormOpen(true)
  }

  function changeProgram(nextProgramId: string) {
    setProgramId(nextProgramId)
    resetSelections()
    const program = programs.find((row) => row.id === nextProgramId)
    if (program) {
      const today = todayIso()
      setTrainingDate(today >= program.start_date && today <= program.end_date ? today : program.start_date)
    }
  }

  function toggleBlock(blockId: string, checked: boolean) {
    const nextBlocks = new Set(selectedBlocks)
    const nextTechniques = new Set(selectedTechniques)
    const nextSituations = new Set(selectedSituations)
    if (checked) nextBlocks.add(blockId)
    else {
      nextBlocks.delete(blockId)
      for (const technique of techniques.filter((row) => row.block_id === blockId)) {
        nextTechniques.delete(technique.id)
        for (const situation of situations.filter((row) => row.technique_id === technique.id)) nextSituations.delete(situation.id)
      }
    }
    setSelectedBlocks(nextBlocks)
    setSelectedTechniques(nextTechniques)
    setSelectedSituations(nextSituations)
  }

  function toggleTechnique(techniqueId: string, checked: boolean) {
    const nextTechniques = new Set(selectedTechniques)
    const nextSituations = new Set(selectedSituations)
    if (checked) nextTechniques.add(techniqueId)
    else {
      nextTechniques.delete(techniqueId)
      for (const situation of situations.filter((row) => row.technique_id === techniqueId)) nextSituations.delete(situation.id)
    }
    setSelectedTechniques(nextTechniques)
    setSelectedSituations(nextSituations)
  }

  function toggleSituation(situationId: string, checked: boolean) {
    const next = new Set(selectedSituations)
    if (checked) next.add(situationId)
    else next.delete(situationId)
    setSelectedSituations(next)
  }

  async function saveLog(complete: boolean) {
    resetFeedback()
    if (!programId) {
      setError('Choose a published training program.')
      return
    }
    if (!trainingDate || !sessionTime) {
      setError('Training date and time are required.')
      return
    }
    if (complete && selectedBlocks.size + selectedTechniques.size + selectedSituations.size === 0) {
      setError('Select at least one block, technique or situation before completing the log.')
      return
    }

    setPending(true)
    try {
      const response = await fetch('/api/coach-operations/training-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'save',
          id: editingId,
          programId,
          trainingDate,
          sessionTime,
          notes,
          blockIds: Array.from(selectedBlocks),
          techniqueIds: Array.from(selectedTechniques),
          situationIds: Array.from(selectedSituations),
          complete,
        }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        setError(String(data.details || data.error || 'Unable to save training log.'))
        return
      }
      setMessage(complete ? 'Training log completed.' : 'Training log saved as draft.')
      setFormOpen(false)
      setEditingId(null)
      setCompleteConfirm(false)
      router.refresh()
    } catch (err: any) {
      setError(err?.message || 'Unable to save training log.')
    } finally {
      setPending(false)
    }
  }

  async function reopenLog() {
    if (!reopenTarget) return
    resetFeedback()
    setPending(true)
    try {
      const response = await fetch('/api/coach-operations/training-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'reopen', id: reopenTarget.id }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        setError(String(data.details || data.error || 'Unable to reopen training log.'))
        return
      }
      setMessage('Training log reopened as draft.')
      setReopenTarget(null)
      router.refresh()
    } catch (err: any) {
      setError(err?.message || 'Unable to reopen training log.')
    } finally {
      setPending(false)
    }
  }

  function toggleLogDetails(id: string) {
    const next = new Set(expandedLogs)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpandedLogs(next)
  }

  function renderLogItems(log: SessionLog) {
    const items = logItems.filter((item) => item.session_log_id === log.id)
    const blockItems = items.filter((item) => item.selected_level === 'block')
    if (!blockItems.length) return <p className="text-sm text-[hsl(var(--muted))]">No curriculum item recorded.</p>

    return (
      <div className="space-y-3">
        {blockItems.map((blockItem) => {
          const techniqueItems = items.filter((item) => item.selected_level === 'technique' && item.block_id === blockItem.block_id)
          return (
            <div key={blockItem.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/30 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">{blockItem.type_name_snapshot}</div>
              <div className="mt-1 font-semibold text-black">{blockItem.block_name_snapshot}</div>
              {techniqueItems.length ? (
                <div className="mt-2 space-y-2 border-l border-[hsl(var(--border))] pl-4">
                  {techniqueItems.map((techniqueItem) => {
                    const situationItems = items.filter(
                      (item) => item.selected_level === 'situation' && item.technique_id === techniqueItem.technique_id,
                    )
                    return (
                      <div key={techniqueItem.id}>
                        <div className="text-sm font-medium text-black">{techniqueItem.technique_name_snapshot}</div>
                        {situationItems.length ? (
                          <div className="mt-1.5 space-y-1.5 pl-3">
                            {situationItems.map((situationItem) => (
                              <div key={situationItem.id} className="rounded-xl bg-white px-3 py-2 text-xs">
                                <div className="font-semibold text-black">{situationItem.situation_name_snapshot}</div>
                                {situationItem.opponent_reaction_snapshot ? (
                                  <div className="mt-0.5 text-[hsl(var(--muted))]">Opponent reaction: {situationItem.opponent_reaction_snapshot}</div>
                                ) : null}
                                {situationItem.coaching_response_snapshot ? (
                                  <div className="mt-0.5 text-[hsl(var(--muted))]">Coach response: {situationItem.coaching_response_snapshot}</div>
                                ) : null}
                              </div>
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
    )
  }

  return (
    <div className="space-y-4">
      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div> : null}
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
        <div>
          <h2 className="font-semibold text-black">Training session logs</h2>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">Completed logs are shared across the coaching team for technical continuity.</p>
        </div>
        {canCreate ? (
          <Button type="button" onClick={openNew} disabled={!programs.length || pending}>
            <Plus className="h-4 w-4" /> New training log
          </Button>
        ) : null}
      </div>

      {!programs.length ? (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          No published Training Program is available. The Head Coach must publish a program before a session can be logged.
        </div>
      ) : null}

      {formOpen ? (
        <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-black">{editingId ? 'Edit training log' : 'New training log'}</h3>
              <p className="mt-1 text-xs text-[hsl(var(--muted))]">Select what was actually worked from the published program. Save as draft or complete the log.</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setFormOpen(false)} disabled={pending}>Close</Button>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <label className="block md:col-span-1">
              <span className="mb-1.5 block text-sm font-semibold text-black">Published program</span>
              <select
                value={programId}
                onChange={(event) => changeProgram(event.target.value)}
                disabled={pending}
                className="min-h-[44px] w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3.5 py-2.5 text-sm text-black shadow-soft outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Choose program</option>
                {programs.map((program) => (
                  <option key={program.id} value={program.id}>{program.title} · {program.target_group}</option>
                ))}
              </select>
            </label>
            <Input
              label="Training date"
              type="date"
              value={trainingDate}
              min={currentProgram?.start_date}
              max={currentProgram?.end_date}
              onChange={(event) => setTrainingDate(event.target.value)}
              disabled={pending || !currentProgram}
            />
            <Input label="Session time" type="time" value={sessionTime} onChange={(event) => setSessionTime(event.target.value)} disabled={pending} />
          </div>

          {currentProgram ? (
            <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
              <div className="font-semibold">{currentProgram.target_group}</div>
              <div className="mt-0.5 text-xs">Program period: {formatDate(currentProgram.start_date)} → {formatDate(currentProgram.end_date)}</div>
              {currentProgram.notes ? <div className="mt-2 whitespace-pre-wrap text-xs">Head Coach notes: {currentProgram.notes}</div> : null}
            </div>
          ) : null}

          {currentProgram ? (
            <div className="mt-4">
              <div className="mb-2">
                <h4 className="text-sm font-semibold text-black">What was actually worked?</h4>
                <p className="text-xs text-[hsl(var(--muted))]">Select the block first, then the technique and the relevant opponent-reaction situation when applicable.</p>
              </div>
              <div className="space-y-3">
                {Array.from(
                  allowedBlocks(currentProgram.id).reduce((map, block) => {
                    const list = map.get(block.type_id) ?? []
                    list.push(block)
                    map.set(block.type_id, list)
                    return map
                  }, new Map<string, CurriculumBlock[]>()),
                ).map(([typeId, typeBlocks]) => (
                  <div key={typeId} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/30 p-3">
                    <div className="text-sm font-semibold">{typeMap.get(typeId)?.name ?? 'Technical'}</div>
                    <div className="mt-2 space-y-2">
                      {typeBlocks.map((block) => {
                        const blockSelected = selectedBlocks.has(block.id)
                        const childTechniques = allowedTechniques(currentProgram.id, block.id)
                        return (
                          <div key={block.id} className="rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
                            <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold">
                              <input type="checkbox" className="h-4 w-4" checked={blockSelected} onChange={(event) => toggleBlock(block.id, event.target.checked)} />
                              {block.name}{!block.is_active ? ' (Archived)' : ''}
                            </label>
                            {blockSelected && childTechniques.length ? (
                              <div className="mt-3 space-y-2 border-l border-[hsl(var(--border))] pl-4">
                                {childTechniques.map((technique) => {
                                  const techniqueSelected = selectedTechniques.has(technique.id)
                                  const childSituations = allowedSituations(currentProgram.id, technique.id)
                                  return (
                                    <div key={technique.id}>
                                      <label className="flex cursor-pointer items-center gap-3 text-sm">
                                        <input type="checkbox" className="h-4 w-4" checked={techniqueSelected} onChange={(event) => toggleTechnique(technique.id, event.target.checked)} />
                                        <span className="font-medium">{technique.name}{!technique.is_active ? ' (Archived)' : ''}</span>
                                      </label>
                                      {techniqueSelected && childSituations.length ? (
                                        <div className="mt-2 space-y-2 pl-7">
                                          {childSituations.map((situation) => (
                                            <label key={situation.id} className="flex cursor-pointer items-start gap-3 rounded-xl bg-[hsl(var(--surface-2))] px-3 py-2 text-xs">
                                              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={selectedSituations.has(situation.id)} onChange={(event) => toggleSituation(situation.id, event.target.checked)} />
                                              <span>
                                                <span className="font-semibold text-black">{situation.name}{!situation.is_active ? ' (Archived)' : ''}</span>
                                                <span className="mt-0.5 block text-[hsl(var(--muted))]">Opponent reaction: {situation.opponent_reaction}</span>
                                                {situation.coaching_response ? <span className="mt-0.5 block text-[hsl(var(--muted))]">Coach response: {situation.coaching_response}</span> : null}
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
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-4">
            <Textarea label="Session notes (optional)" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="What went well? What should the next coach repeat or continue?" />
          </div>

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="button" variant="outline" loading={pending} loadingText="Saving…" onClick={() => saveLog(false)}>Save draft</Button>
            <Button type="button" disabled={pending || !selectedBlocks.size} onClick={() => setCompleteConfirm(true)}>
              <CheckCircle2 className="h-4 w-4" /> Complete training log
            </Button>
          </div>
        </div>
      ) : null}

      {!logs.length ? (
        <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white p-8 text-center">
          <ClipboardList className="mx-auto h-8 w-8 text-[hsl(var(--muted))]" />
          <div className="mt-3 font-semibold">No training log yet</div>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">Completed sessions will build the shared coaching history for each group.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => {
            const expanded = expandedLogs.has(log.id)
            const programAvailable = programs.some((program) => program.id === log.program_id)
            const canEdit = programAvailable && log.status === 'draft' && (canManage || log.coach_user_id === currentUserId)
            return (
              <div key={log.id} className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-black">{log.target_group_snapshot}</h3>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${log.status === 'completed' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                        {log.status === 'completed' ? 'Completed' : 'Draft'}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-[hsl(var(--muted))]">{formatDate(log.training_date)} · {normalizeTime(log.session_time)} · {log.coach_name_snapshot}</div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">Program: {log.program_title_snapshot} · {roleLabel(log.coach_role_snapshot)}</div>
                    {!programAvailable && log.status === 'draft' ? <div className="mt-1 text-xs font-medium text-amber-700">Program is no longer published. Republish it before editing or completing this draft.</div> : null}
                    {log.notes ? <p className="mt-2 whitespace-pre-wrap text-sm text-black">{log.notes}</p> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => toggleLogDetails(log.id)}>
                      <ChevronDown className={`h-4 w-4 transition ${expanded ? 'rotate-180' : ''}`} /> {expanded ? 'Hide' : 'View'} details
                    </Button>
                    {canEdit ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => openEdit(log)}><Pencil className="h-4 w-4" /> Edit draft</Button>
                    ) : null}
                    {canManage && programAvailable && log.status === 'completed' ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setReopenTarget(log)}><RotateCcw className="h-4 w-4" /> Reopen</Button>
                    ) : null}
                  </div>
                </div>
                {expanded ? <div className="mt-4">{renderLogItems(log)}</div> : null}
              </div>
            )
          })}
        </div>
      )}

      <ConfirmActionModal
        open={completeConfirm}
        title="Complete training log?"
        description="Once completed, this session becomes part of the shared coaching history. Coach and Assistant Coach cannot edit it again unless Head Coach or Super Admin reopens it."
        confirmLabel="Complete log"
        pending={pending}
        summaryItems={currentProgram ? [
          { label: 'Program', value: currentProgram.title },
          { label: 'Group', value: currentProgram.target_group },
          { label: 'Session', value: `${formatDate(trainingDate)} · ${sessionTime}` },
          { label: 'Blocks worked', value: selectedBlocks.size },
        ] : []}
        onCancel={() => !pending && setCompleteConfirm(false)}
        onConfirm={() => saveLog(true)}
      />

      <ConfirmActionModal
        open={Boolean(reopenTarget)}
        title="Reopen completed training log?"
        description="The log will return to Draft so it can be corrected and completed again. The reopen action is recorded."
        confirmLabel="Reopen log"
        pending={pending}
        summaryItems={reopenTarget ? [
          { label: 'Group', value: reopenTarget.target_group_snapshot },
          { label: 'Session', value: `${formatDate(reopenTarget.training_date)} · ${normalizeTime(reopenTarget.session_time)}` },
          { label: 'Coach', value: reopenTarget.coach_name_snapshot },
        ] : []}
        onCancel={() => !pending && setReopenTarget(null)}
        onConfirm={reopenLog}
      />
    </div>
  )
}
