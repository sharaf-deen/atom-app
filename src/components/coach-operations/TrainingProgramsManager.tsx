'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Archive, CalendarDays, ChevronDown, Pencil, Plus, RotateCcw, Send } from 'lucide-react'
import Button from '@/components/ui/Button'
import ConfirmActionModal from '@/components/ui/ConfirmActionModal'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'

type ProgramStatus = 'draft' | 'published' | 'archived'

type Program = {
  id: string
  title: string
  target_group: string
  start_date: string
  end_date: string
  notes: string | null
  status: ProgramStatus
  published_at: string | null
  updated_at: string
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

type CurriculumType = {
  id: string
  name: string
  sort_order: number
  is_active: boolean
}

type CurriculumBlock = {
  id: string
  type_id: string
  name: string
  sort_order: number
  is_active: boolean
}

type CurriculumTechnique = {
  id: string
  block_id: string
  name: string
  sort_order: number
  is_active: boolean
}

type CurriculumSituation = {
  id: string
  technique_id: string
  name: string
  opponent_reaction: string
  coaching_response: string | null
  sort_order: number
  is_active: boolean
}

type StatusTarget = {
  id: string
  title: string
  nextStatus: ProgramStatus
}

function todayIso() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function plusDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00`)
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function statusClass(status: ProgramStatus) {
  if (status === 'published') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'archived') return 'border-slate-200 bg-slate-100 text-slate-600'
  return 'border-amber-200 bg-amber-50 text-amber-800'
}

function statusLabel(status: ProgramStatus) {
  if (status === 'published') return 'Published'
  if (status === 'archived') return 'Archived'
  return 'Draft'
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => null)
  return data && typeof data === 'object' ? (data as Record<string, any>) : {}
}

export default function TrainingProgramsManager({
  canManage,
  programs,
  items,
  types,
  blocks,
  techniques,
  situations,
}: {
  canManage: boolean
  programs: Program[]
  items: ProgramItem[]
  types: CurriculumType[]
  blocks: CurriculumBlock[]
  techniques: CurriculumTechnique[]
  situations: CurriculumSituation[]
}) {
  const router = useRouter()
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [formOpen, setFormOpen] = React.useState(false)
  const [title, setTitle] = React.useState('')
  const [targetGroup, setTargetGroup] = React.useState('')
  const [startDate, setStartDate] = React.useState(todayIso())
  const [endDate, setEndDate] = React.useState(plusDays(todayIso(), 6))
  const [notes, setNotes] = React.useState('')
  const [selectedBlocks, setSelectedBlocks] = React.useState<Set<string>>(new Set())
  const [selectedTechniques, setSelectedTechniques] = React.useState<Set<string>>(new Set())
  const [selectedSituations, setSelectedSituations] = React.useState<Set<string>>(new Set())
  const [expandedPrograms, setExpandedPrograms] = React.useState<Set<string>>(new Set())
  const [pending, setPending] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [statusTarget, setStatusTarget] = React.useState<StatusTarget | null>(null)

  const activeTypes = types.filter((row) => row.is_active)
  const activeBlocks = blocks.filter((row) => row.is_active)
  const activeTechniques = techniques.filter((row) => row.is_active)
  const activeSituations = situations.filter((row) => row.is_active)

  function resetFeedback() {
    setMessage(null)
    setError(null)
  }

  function openNew() {
    resetFeedback()
    setEditingId(null)
    setTitle('')
    setTargetGroup('')
    setStartDate(todayIso())
    setEndDate(plusDays(todayIso(), 6))
    setNotes('')
    setSelectedBlocks(new Set())
    setSelectedTechniques(new Set())
    setSelectedSituations(new Set())
    setFormOpen(true)
  }

  function openEdit(program: Program) {
    resetFeedback()
    setEditingId(program.id)
    setTitle(program.title)
    setTargetGroup(program.target_group)
    setStartDate(program.start_date)
    setEndDate(program.end_date)
    setNotes(program.notes ?? '')
    const programItems = items.filter((item) => item.program_id === program.id)
    setSelectedBlocks(new Set(programItems.filter((item) => item.selected_level === 'block').map((item) => item.block_id)))
    setSelectedTechniques(
      new Set(programItems.filter((item) => item.selected_level === 'technique' && item.technique_id).map((item) => item.technique_id!)),
    )
    setSelectedSituations(
      new Set(programItems.filter((item) => item.selected_level === 'situation' && item.situation_id).map((item) => item.situation_id!)),
    )
    setFormOpen(true)
  }

  function toggleBlock(blockId: string, checked: boolean) {
    const nextBlocks = new Set(selectedBlocks)
    const nextTechniques = new Set(selectedTechniques)
    const nextSituations = new Set(selectedSituations)
    if (checked) {
      nextBlocks.add(blockId)
    } else {
      nextBlocks.delete(blockId)
      const childTechniqueIds = techniques.filter((row) => row.block_id === blockId).map((row) => row.id)
      for (const techniqueId of childTechniqueIds) {
        nextTechniques.delete(techniqueId)
        for (const situation of situations.filter((row) => row.technique_id === techniqueId)) nextSituations.delete(situation.id)
      }
    }
    setSelectedBlocks(nextBlocks)
    setSelectedTechniques(nextTechniques)
    setSelectedSituations(nextSituations)
  }

  function toggleTechnique(techniqueId: string, checked: boolean) {
    const next = new Set(selectedTechniques)
    const nextSituations = new Set(selectedSituations)
    if (checked) next.add(techniqueId)
    else {
      next.delete(techniqueId)
      for (const situation of situations.filter((row) => row.technique_id === techniqueId)) nextSituations.delete(situation.id)
    }
    setSelectedTechniques(next)
    setSelectedSituations(nextSituations)
  }

  function toggleSituation(situationId: string, checked: boolean) {
    const next = new Set(selectedSituations)
    if (checked) next.add(situationId)
    else next.delete(situationId)
    setSelectedSituations(next)
  }

  async function saveProgram(event: React.FormEvent) {
    event.preventDefault()
    resetFeedback()
    const cleanTitle = title.replace(/\s+/g, ' ').trim()
    const cleanGroup = targetGroup.replace(/\s+/g, ' ').trim()
    if (cleanTitle.length < 2) return setError('Enter a program title.')
    if (cleanGroup.length < 2) return setError('Enter the group or class this program is for.')
    if (!startDate || !endDate || endDate < startDate) return setError('Choose a valid program period.')
    if (!selectedBlocks.size) return setError('Select at least one technical block.')

    setPending(true)
    try {
      const response = await fetch('/api/coach-operations/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'save',
          id: editingId,
          title: cleanTitle,
          targetGroup: cleanGroup,
          startDate,
          endDate,
          notes,
          blockIds: Array.from(selectedBlocks),
          techniqueIds: Array.from(selectedTechniques),
          situationIds: Array.from(selectedSituations),
        }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        throw new Error(data.details || data.error || 'Failed to save training program.')
      }
      setMessage(editingId ? 'Training program updated.' : 'Training program created as draft.')
      setFormOpen(false)
      router.refresh()
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setPending(false)
    }
  }

  async function applyStatus() {
    if (!statusTarget) return
    setPending(true)
    resetFeedback()
    try {
      const response = await fetch('/api/coach-operations/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'set_status', id: statusTarget.id, status: statusTarget.nextStatus }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) throw new Error(data.details || data.error || 'Failed to update program status.')
      setMessage(`Program ${statusTarget.nextStatus === 'published' ? 'published' : statusTarget.nextStatus === 'draft' ? 'returned to draft' : 'archived'}.`)
      setStatusTarget(null)
      router.refresh()
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setPending(false)
    }
  }

  function toggleProgramDetails(id: string) {
    const next = new Set(expandedPrograms)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpandedPrograms(next)
  }

  function renderAssignedCurriculum(program: Program) {
    const programItems = items.filter((item) => item.program_id === program.id)
    const blockIds = new Set(programItems.filter((item) => item.selected_level === 'block').map((item) => item.block_id))
    const techniqueIds = new Set(programItems.filter((item) => item.technique_id).map((item) => item.technique_id!))
    const situationIds = new Set(programItems.filter((item) => item.situation_id).map((item) => item.situation_id!))

    return (
      <div className="space-y-3">
        {types.map((type) => {
          const typeBlocks = blocks.filter((block) => block.type_id === type.id && blockIds.has(block.id))
          if (!typeBlocks.length) return null
          return (
            <div key={type.id} className="rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">{type.name}</div>
              <div className="mt-2 space-y-3">
                {typeBlocks.map((block) => {
                  const childTechniques = techniques.filter((technique) => technique.block_id === block.id && techniqueIds.has(technique.id))
                  return (
                    <div key={block.id}>
                      <div className="font-semibold text-black">{block.name}</div>
                      {childTechniques.length ? (
                        <div className="mt-1 space-y-2 border-l border-[hsl(var(--border))] pl-3">
                          {childTechniques.map((technique) => {
                            const childSituations = situations.filter(
                              (situation) => situation.technique_id === technique.id && situationIds.has(situation.id),
                            )
                            return (
                              <div key={technique.id}>
                                <div className="text-sm font-medium text-black">{technique.name}</div>
                                {childSituations.length ? (
                                  <div className="mt-1 space-y-1 pl-3 text-xs text-[hsl(var(--muted))]">
                                    {childSituations.map((situation) => (
                                      <div key={situation.id}>
                                        <span className="font-medium text-black">{situation.name}</span> — {situation.opponent_reaction}
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
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div> : null}
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Training programs</h2>
          <p className="text-sm text-[hsl(var(--muted))]">
            {canManage ? 'Prepare and publish curriculum for a group or class.' : 'Published programs shared by the Head Coach.'}
          </p>
        </div>
        {canManage ? (
          <Button type="button" onClick={openNew}>
            <Plus className="h-4 w-4" /> New program
          </Button>
        ) : null}
      </div>

      {canManage && formOpen ? (
        <form onSubmit={saveProgram} className="space-y-5 rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold">{editingId ? 'Edit training program' : 'New training program'}</h3>
              <p className="text-xs text-[hsl(var(--muted))]">The existing Schedule remains unchanged. Use the class/group name used by the academy.</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setFormOpen(false)} disabled={pending}>Close</Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Input label="Program title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="September Week 1 · Guard Passing" />
            <Input label="Group / class" value={targetGroup} onChange={(event) => setTargetGroup(event.target.value)} placeholder="Kids 6–9 Beginners" hint="Use the same group name used in the academy Schedule." />
            <Input label="Start date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            <Input label="End date" type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} />
          </div>
          <Textarea label="Head Coach notes (optional)" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Focus on control before speed…" />

          <div>
            <div className="mb-2">
              <h4 className="text-sm font-semibold">Curriculum assignment</h4>
              <p className="text-xs text-[hsl(var(--muted))]">Select a block first. Its techniques become available, then each technique reveals its situations.</p>
            </div>
            <div className="space-y-3">
              {activeTypes.map((type) => {
                const typeBlocks = activeBlocks.filter((block) => block.type_id === type.id)
                if (!typeBlocks.length) return null
                return (
                  <div key={type.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/30 p-3">
                    <div className="text-sm font-semibold">{type.name}</div>
                    <div className="mt-2 space-y-2">
                      {typeBlocks.map((block) => {
                        const blockSelected = selectedBlocks.has(block.id)
                        const childTechniques = activeTechniques.filter((technique) => technique.block_id === block.id)
                        return (
                          <div key={block.id} className="rounded-2xl border border-[hsl(var(--border))] bg-white p-3">
                            <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold">
                              <input type="checkbox" checked={blockSelected} onChange={(event) => toggleBlock(block.id, event.target.checked)} className="h-4 w-4" />
                              {block.name}
                            </label>
                            {blockSelected && childTechniques.length ? (
                              <div className="mt-3 space-y-2 border-l border-[hsl(var(--border))] pl-4">
                                {childTechniques.map((technique) => {
                                  const techniqueSelected = selectedTechniques.has(technique.id)
                                  const childSituations = activeSituations.filter((situation) => situation.technique_id === technique.id)
                                  return (
                                    <div key={technique.id}>
                                      <label className="flex cursor-pointer items-center gap-3 text-sm">
                                        <input type="checkbox" checked={techniqueSelected} onChange={(event) => toggleTechnique(technique.id, event.target.checked)} className="h-4 w-4" />
                                        <span className="font-medium">{technique.name}</span>
                                      </label>
                                      {techniqueSelected && childSituations.length ? (
                                        <div className="mt-2 space-y-2 pl-7">
                                          {childSituations.map((situation) => (
                                            <label key={situation.id} className="flex cursor-pointer items-start gap-3 rounded-xl bg-[hsl(var(--surface-2))] px-3 py-2 text-xs">
                                              <input type="checkbox" checked={selectedSituations.has(situation.id)} onChange={(event) => toggleSituation(situation.id, event.target.checked)} className="mt-0.5 h-4 w-4" />
                                              <span>
                                                <span className="font-semibold text-black">{situation.name}</span>
                                                <span className="mt-0.5 block text-[hsl(var(--muted))]">Opponent reaction: {situation.opponent_reaction}</span>
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
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" loading={pending} loadingText="Saving…">Save program</Button>
          </div>
        </form>
      ) : null}

      {!programs.length ? (
        <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white p-8 text-center">
          <CalendarDays className="mx-auto h-8 w-8 text-[hsl(var(--muted))]" />
          <div className="mt-3 font-semibold">No training program yet</div>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">{canManage ? 'Create the first program from the shared curriculum.' : 'The Head Coach has not published a program yet.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {programs.map((program) => {
            const expanded = expandedPrograms.has(program.id)
            return (
              <div key={program.id} className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-black">{program.title}</h3>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(program.status)}`}>{statusLabel(program.status)}</span>
                    </div>
                    <div className="mt-1 text-sm text-[hsl(var(--muted))]">{program.target_group} · {formatDate(program.start_date)} → {formatDate(program.end_date)}</div>
                    {program.notes ? <p className="mt-2 whitespace-pre-wrap text-sm text-black">{program.notes}</p> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => toggleProgramDetails(program.id)}>
                      <ChevronDown className={`h-4 w-4 transition ${expanded ? 'rotate-180' : ''}`} /> {expanded ? 'Hide' : 'View'} program
                    </Button>
                    {canManage ? (
                      <>
                        <Button type="button" variant="outline" size="sm" onClick={() => openEdit(program)}><Pencil className="h-4 w-4" /> Edit</Button>
                        {program.status !== 'published' ? (
                          <Button type="button" size="sm" onClick={() => setStatusTarget({ id: program.id, title: program.title, nextStatus: 'published' })}><Send className="h-4 w-4" /> Publish</Button>
                        ) : (
                          <Button type="button" variant="outline" size="sm" onClick={() => setStatusTarget({ id: program.id, title: program.title, nextStatus: 'draft' })}><RotateCcw className="h-4 w-4" /> Unpublish</Button>
                        )}
                        {program.status !== 'archived' ? (
                          <Button type="button" variant="ghost" size="sm" onClick={() => setStatusTarget({ id: program.id, title: program.title, nextStatus: 'archived' })}><Archive className="h-4 w-4" /> Archive</Button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
                {expanded ? <div className="mt-4">{renderAssignedCurriculum(program)}</div> : null}
              </div>
            )
          })}
        </div>
      )}

      <ConfirmActionModal
        open={Boolean(statusTarget)}
        title={statusTarget?.nextStatus === 'published' ? 'Publish training program?' : statusTarget?.nextStatus === 'draft' ? 'Unpublish training program?' : 'Archive training program?'}
        description={statusTarget?.nextStatus === 'published' ? 'Coach and Assistant Coach will be able to read this program.' : statusTarget?.nextStatus === 'draft' ? 'Coach and Assistant Coach will no longer see this program until it is published again.' : 'Archived programs are kept for history but hidden from Coach and Assistant Coach.'}
        confirmLabel={statusTarget?.nextStatus === 'published' ? 'Publish' : statusTarget?.nextStatus === 'draft' ? 'Unpublish' : 'Archive'}
        tone={statusTarget?.nextStatus === 'archived' ? 'destructive' : 'default'}
        pending={pending}
        summaryItems={statusTarget ? [{ label: 'Program', value: statusTarget.title }] : []}
        onCancel={() => !pending && setStatusTarget(null)}
        onConfirm={applyStatus}
      />
    </div>
  )
}
