'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Archive, CalendarDays, ChevronDown, Pencil, Plus, RotateCcw, Send, Trash2, Users } from 'lucide-react'
import Button from '@/components/ui/Button'
import ConfirmActionModal from '@/components/ui/ConfirmActionModal'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
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
  responsible_coach_user_id: string | null
  responsible_coach_name_snapshot: string | null
  responsible_coach_role_snapshot: string | null
  assistant_coach_1_user_id: string | null
  assistant_coach_1_name_snapshot: string | null
  assistant_coach_1_role_snapshot: string | null
  assistant_coach_2_user_id: string | null
  assistant_coach_2_name_snapshot: string | null
  assistant_coach_2_role_snapshot: string | null
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


type StaffOption = {
  user_id: string
  full_name: string
  email: string | null
  member_id: string | null
  role: 'assistant_coach' | 'coach' | 'head_coach' | 'super_admin'
}


type ScheduleClassTemplate = {
  id: string
  series_key: string
  name: string
  day_of_week: number
  start_time: string
  mat: string | null
  uniform: string
  is_active: boolean
  effective_from: string
  effective_until: string | null
}

type ProgramClassTemplate = {
  id: string
  program_id: string
  class_template_id: string
  class_name_snapshot: string
  series_key_snapshot: string
  day_of_week_snapshot: number
  start_time_snapshot: string
  mat_snapshot: string | null
  is_active: boolean
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function normalizeClock(value: string) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})/)
  return match ? `${match[1]}:${match[2]}` : value
}

function templateLabel(template: Pick<ScheduleClassTemplate, 'day_of_week' | 'start_time' | 'mat' | 'uniform'>) {
  const day = DAY_LABELS[template.day_of_week] ?? `Day ${template.day_of_week}`
  const mat = template.mat ? ` · ${template.mat}` : ''
  const uniform = template.uniform && template.uniform !== 'none' ? ` · ${template.uniform.toUpperCase()}` : ''
  return `${day} · ${normalizeClock(template.start_time)}${uniform}${mat}`
}

function mappingLabel(mapping: ProgramClassTemplate, template?: ScheduleClassTemplate) {
  if (template) return templateLabel(template)
  const day = DAY_LABELS[mapping.day_of_week_snapshot] ?? `Day ${mapping.day_of_week_snapshot}`
  const mat = mapping.mat_snapshot ? ` · ${mapping.mat_snapshot}` : ''
  return `${day} · ${normalizeClock(mapping.start_time_snapshot)}${mat}`
}

function staffRoleLabel(value: StaffOption['role'] | string | null) {
  if (!value) return 'Coach'
  return String(value)
    .split('_')
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(' ')
}

type StatusTarget = {
  id: string
  title: string
  nextStatus: ProgramStatus
}

type DeleteTarget = {
  id: string
  title: string
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
  canDeletePermanent,
  viewerUserId,
  programs,
  items,
  types,
  blocks,
  techniques,
  situations,
  classTemplates,
  programClassTemplates,
}: {
  canManage: boolean
  canDeletePermanent: boolean
  viewerUserId: string
  programs: Program[]
  items: ProgramItem[]
  types: CurriculumType[]
  blocks: CurriculumBlock[]
  techniques: CurriculumTechnique[]
  situations: CurriculumSituation[]
  classTemplates: ScheduleClassTemplate[]
  programClassTemplates: ProgramClassTemplate[]
}) {
  const router = useRouter()
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [formOpen, setFormOpen] = React.useState(false)
  const [title, setTitle] = React.useState('')
  const [targetGroup, setTargetGroup] = React.useState('')
  const [startDate, setStartDate] = React.useState(todayIso())
  const [endDate, setEndDate] = React.useState(plusDays(todayIso(), 6))
  const [notes, setNotes] = React.useState('')
  const [responsibleCoachUserId, setResponsibleCoachUserId] = React.useState('')
  const [assistantCoachUserIds, setAssistantCoachUserIds] = React.useState<string[]>([])
  const [staffOptions, setStaffOptions] = React.useState<StaffOption[]>([])
  const [staffLoaded, setStaffLoaded] = React.useState(false)
  const [staffLoading, setStaffLoading] = React.useState(false)
  const [staffError, setStaffError] = React.useState<string | null>(null)
  const [selectedBlocks, setSelectedBlocks] = React.useState<Set<string>>(new Set())
  const [selectedTechniques, setSelectedTechniques] = React.useState<Set<string>>(new Set())
  const [selectedSituations, setSelectedSituations] = React.useState<Set<string>>(new Set())
  const [selectedClassTemplateIds, setSelectedClassTemplateIds] = React.useState<Set<string>>(new Set())
  const [expandedPrograms, setExpandedPrograms] = React.useState<Set<string>>(new Set())
  const [pending, setPending] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [statusTarget, setStatusTarget] = React.useState<StatusTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<DeleteTarget | null>(null)

  const activeTypes = types.filter((row) => row.is_active)
  const activeBlocks = blocks.filter((row) => row.is_active)
  const activeTechniques = techniques.filter((row) => row.is_active)
  const activeSituations = situations.filter((row) => row.is_active)
  const activeClassTemplates = classTemplates.filter((row) => row.is_active)
  const classTemplateById = React.useMemo(() => new Map(classTemplates.map((row) => [row.id, row])), [classTemplates])
  const visiblePrograms = React.useMemo(
    () =>
      canManage
        ? programs
        : programs.filter(
            (program) =>
              program.responsible_coach_user_id === viewerUserId
              || program.assistant_coach_1_user_id === viewerUserId
              || program.assistant_coach_2_user_id === viewerUserId,
          ),
    [canManage, programs, viewerUserId],
  )

  const templateGroups = React.useMemo(() => {
    const map = new Map<string, ScheduleClassTemplate[]>()
    for (const template of activeClassTemplates) {
      const key = template.series_key || template.name
      const current = map.get(key) ?? []
      current.push(template)
      map.set(key, current)
    }
    return Array.from(map.entries())
      .map(([key, rows]) => [key, rows.sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time))] as const)
      .sort((a, b) => a[1][0]?.name.localeCompare(b[1][0]?.name ?? '') || 0)
  }, [activeClassTemplates])

  function resetFeedback() {
    setMessage(null)
    setError(null)
  }

  async function loadStaff() {
    if (staffLoaded || staffLoading) return
    setStaffLoading(true)
    setStaffError(null)
    try {
      const response = await fetch('/api/schedule/session-assignments', { method: 'GET', cache: 'no-store' })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        throw new Error(data.details || data.error || 'Failed to load coaching staff.')
      }
      setStaffOptions((data.items ?? []) as StaffOption[])
      setStaffLoaded(true)
    } catch (cause: any) {
      setStaffError(String(cause?.message || cause))
    } finally {
      setStaffLoading(false)
    }
  }

  function toggleProgramAssistant(userId: string) {
    setAssistantCoachUserIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : current.length >= 2
          ? current
          : [...current, userId],
    )
  }

  function openNew() {
    resetFeedback()
    setEditingId(null)
    setTitle('')
    setTargetGroup('')
    setStartDate(todayIso())
    setEndDate(plusDays(todayIso(), 6))
    setNotes('')
    setResponsibleCoachUserId('')
    setAssistantCoachUserIds([])
    setSelectedBlocks(new Set())
    setSelectedTechniques(new Set())
    setSelectedSituations(new Set())
    setSelectedClassTemplateIds(new Set())
    void loadStaff()
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
    setResponsibleCoachUserId(program.responsible_coach_user_id ?? '')
    setAssistantCoachUserIds(
      [program.assistant_coach_1_user_id, program.assistant_coach_2_user_id].filter((id): id is string => Boolean(id)),
    )
    void loadStaff()
    const programItems = items.filter((item) => item.program_id === program.id)
    setSelectedBlocks(new Set(programItems.filter((item) => item.selected_level === 'block').map((item) => item.block_id)))
    setSelectedTechniques(
      new Set(programItems.filter((item) => item.selected_level === 'technique' && item.technique_id).map((item) => item.technique_id!)),
    )
    setSelectedSituations(
      new Set(programItems.filter((item) => item.selected_level === 'situation' && item.situation_id).map((item) => item.situation_id!)),
    )
    const mappedTemplateIds = programClassTemplates
      .filter((mapping) => mapping.program_id === program.id && mapping.is_active)
      .map((mapping) => mapping.class_template_id)
    if (mappedTemplateIds.length) {
      setSelectedClassTemplateIds(new Set(mappedTemplateIds))
    } else {
      const normalizedGroup = program.target_group.trim().toLowerCase()
      setSelectedClassTemplateIds(
        new Set(activeClassTemplates.filter((template) => template.name.trim().toLowerCase() === normalizedGroup).map((template) => template.id)),
      )
    }
    setFormOpen(true)
  }

  function toggleClassTemplate(templateId: string, checked: boolean) {
    setSelectedClassTemplateIds((current) => {
      const next = new Set(current)
      if (checked) next.add(templateId)
      else next.delete(templateId)
      return next
    })
  }

  function toggleTemplateGroup(groupTemplates: ScheduleClassTemplate[], checked: boolean) {
    setSelectedClassTemplateIds((current) => {
      const next = new Set(current)
      for (const template of groupTemplates) {
        if (checked) next.add(template.id)
        else next.delete(template.id)
      }
      return next
    })
    if (checked && !targetGroup.trim() && groupTemplates[0]?.name) setTargetGroup(groupTemplates[0].name)
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
    if (!responsibleCoachUserId) return setError('Choose the Responsible Coach for this program.')
    if (assistantCoachUserIds.length > 2) return setError('Choose no more than two assistant coaches.')
    if (assistantCoachUserIds.includes(responsibleCoachUserId)) return setError('The Responsible Coach cannot also be an assistant.')
    if (!selectedClassTemplateIds.size) return setError('Select at least one recurring Schedule class for this program.')
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
          responsibleCoachUserId,
          assistantCoachUserIds,
          classTemplateIds: Array.from(selectedClassTemplateIds),
          blockIds: Array.from(selectedBlocks),
          techniqueIds: Array.from(selectedTechniques),
          situationIds: Array.from(selectedSituations),
        }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        throw new Error(data.details || data.error || 'Failed to save training program.')
      }
      const sync = data.scheduleSync?.sync ?? data.scheduleSync ?? null
      const linked = Number(sync?.linked ?? 0)
      setMessage(
        editingId
          ? `Training program updated.${linked ? ` ${linked} upcoming session${linked === 1 ? '' : 's'} linked automatically.` : ''}`
          : 'Training program created as draft. Publish it to push the program to its scheduled classes.',
      )
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

  async function confirmPermanentDelete() {
    if (!deleteTarget || !canDeletePermanent) return
    setPending(true)
    resetFeedback()
    try {
      const response = await fetch('/api/coach-operations/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'delete_permanent', id: deleteTarget.id }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        throw new Error(data.details || data.error || 'Permanent delete was blocked.')
      }

      setMessage(`${deleteTarget.title} permanently deleted.`)
      setDeleteTarget(null)
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
          <h2 className="text-lg font-semibold">{canManage ? 'Training programs' : 'My programs'}</h2>
          <p className="text-sm text-[hsl(var(--muted))]">
            {canManage
              ? canDeletePermanent
                ? 'Prepare curriculum, recurring classes and coaching teams. Unused test programs can be permanently deleted.'
                : 'Prepare curriculum, recurring classes and coaching teams.'
              : 'Published programs where you are assigned as Responsible Coach or Assistant Coach.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!canManage ? (
            <Link href="/schedule/sessions" className="rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm font-medium hover:bg-black/5">
              My Assigned Sessions
            </Link>
          ) : null}
          {canManage ? (
            <Button type="button" onClick={openNew}>
              <Plus className="h-4 w-4" /> New program
            </Button>
          ) : null}
        </div>
      </div>

      {canManage && formOpen ? (
        <form onSubmit={saveProgram} className="space-y-5 rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold">{editingId ? 'Edit training program' : 'New training program'}</h3>
              <p className="text-xs text-[hsl(var(--muted))]">Choose the recurring Schedule classes once. Published programs will flow automatically to their dated sessions during the program period.</p>
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

          <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4">
            <div>
              <h4 className="text-sm font-semibold text-blue-950">Schedule classes</h4>
              <p className="mt-0.5 text-xs text-blue-900/80">
                Select every recurring class that should receive this program. Existing dated sessions are linked on save/publish, and future generated sessions inherit the same program automatically.
              </p>
            </div>

            {!templateGroups.length ? (
              <div className="mt-3 rounded-xl border border-dashed border-blue-200 bg-white/70 px-3 py-3 text-sm text-blue-900">
                No active recurring Schedule classes are available.
              </div>
            ) : (
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {templateGroups.map(([groupKey, groupTemplates]) => {
                  const selectedCount = groupTemplates.filter((template) => selectedClassTemplateIds.has(template.id)).length
                  const allSelected = selectedCount === groupTemplates.length && groupTemplates.length > 0
                  return (
                    <div key={groupKey} className="rounded-2xl border border-blue-100 bg-white p-3">
                      <label className="flex cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4"
                          checked={allSelected}
                          onChange={(event) => toggleTemplateGroup(groupTemplates, event.target.checked)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-black">{groupTemplates[0]?.name ?? groupKey}</span>
                          <span className="block text-xs text-[hsl(var(--muted))]">{selectedCount}/{groupTemplates.length} recurring sessions selected</span>
                        </span>
                      </label>
                      <div className="mt-2 space-y-1 border-l border-blue-100 pl-4">
                        {groupTemplates.map((template) => (
                          <label key={template.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-xs hover:bg-blue-50">
                            <input
                              type="checkbox"
                              checked={selectedClassTemplateIds.has(template.id)}
                              onChange={(event) => toggleClassTemplate(template.id, event.target.checked)}
                            />
                            <span>{templateLabel(template)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/30 p-4">
            <div className="flex items-start gap-2">
              <Users className="mt-0.5 h-4 w-4 text-[hsl(var(--muted))]" />
              <div>
                <h4 className="text-sm font-semibold">Program coaching team</h4>
                <p className="mt-0.5 text-xs text-[hsl(var(--muted))]">
                  Sessions linked to this program inherit this team automatically. The Responsible Coach can later adjust assistants for one specific session.
                </p>
              </div>
            </div>

            {staffLoading ? <div className="mt-3 text-sm text-[hsl(var(--muted))]">Loading coaching staff…</div> : null}
            {staffError ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{staffError}</div> : null}

            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <Select
                label="Responsible Coach"
                value={responsibleCoachUserId}
                onChange={(event) => {
                  const value = event.target.value
                  setResponsibleCoachUserId(value)
                  setAssistantCoachUserIds((current) => current.filter((id) => id !== value))
                }}
                disabled={pending || staffLoading}
              >
                <option value="">Choose responsible coach</option>
                {staffOptions.map((staff) => (
                  <option key={staff.user_id} value={staff.user_id}>
                    {staff.full_name} · {staffRoleLabel(staff.role)}
                  </option>
                ))}
              </Select>

              <div>
                <div className="text-sm font-medium">Assistant Coach(es)</div>
                <div className="mt-0.5 text-xs text-[hsl(var(--muted))]">Optional · maximum 2 assistants.</div>
                {!responsibleCoachUserId ? (
                  <div className="mt-2 rounded-xl border border-dashed border-[hsl(var(--border))] px-3 py-3 text-sm text-[hsl(var(--muted))]">
                    Choose the Responsible Coach first.
                  </div>
                ) : (
                  <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-[hsl(var(--border))] bg-white p-2">
                    {staffOptions
                      .filter((staff) => staff.user_id !== responsibleCoachUserId)
                      .map((staff) => {
                        const checked = assistantCoachUserIds.includes(staff.user_id)
                        return (
                          <label key={staff.user_id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-black/5">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={pending || (!checked && assistantCoachUserIds.length >= 2)}
                              onChange={() => toggleProgramAssistant(staff.user_id)}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{staff.full_name}</span>
                              <span className="block text-xs text-[hsl(var(--muted))]">{staffRoleLabel(staff.role)}</span>
                            </span>
                          </label>
                        )
                      })}
                  </div>
                )}
              </div>
            </div>
          </div>

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

      {!visiblePrograms.length ? (
        <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white p-8 text-center">
          <CalendarDays className="mx-auto h-8 w-8 text-[hsl(var(--muted))]" />
          <div className="mt-3 font-semibold">{canManage ? 'No training program yet' : 'No program assigned to you'}</div>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">{canManage ? 'Create the first program from the shared curriculum.' : 'When the Head Coach assigns you to a published program, it will appear here.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visiblePrograms.map((program) => {
            const expanded = expandedPrograms.has(program.id)
            const scheduleMappings = programClassTemplates.filter((mapping) => mapping.program_id === program.id && mapping.is_active)
            const viewerRole = program.responsible_coach_user_id === viewerUserId
              ? 'Responsible Coach'
              : program.assistant_coach_1_user_id === viewerUserId || program.assistant_coach_2_user_id === viewerUserId
                ? 'Assistant Coach'
                : null
            return (
              <div key={program.id} className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-black">{program.title}</h3>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(program.status)}`}>{statusLabel(program.status)}</span>
                      {!canManage && viewerRole ? (
                        <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-800">{viewerRole}</span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-sm text-[hsl(var(--muted))]">{program.target_group} · {formatDate(program.start_date)} → {formatDate(program.end_date)}</div>
                    {program.notes ? <p className="mt-2 whitespace-pre-wrap text-sm text-black">{program.notes}</p> : null}
                    <div className="mt-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.04)] px-3 py-2 text-xs">
                      <div><span className="font-semibold">Responsible:</span> {program.responsible_coach_name_snapshot ?? 'Not assigned'}</div>
                      <div className="mt-1 text-[hsl(var(--muted))]">
                        Assistants: {[program.assistant_coach_1_name_snapshot, program.assistant_coach_2_name_snapshot].filter(Boolean).join(', ') || 'None'}
                      </div>
                    </div>
                    <div className="mt-2 rounded-xl border border-blue-100 bg-blue-50/50 px-3 py-2 text-xs text-blue-950">
                      <span className="font-semibold">Schedule:</span>{' '}
                      {scheduleMappings.length
                        ? `${scheduleMappings.length} recurring class${scheduleMappings.length === 1 ? '' : 'es'} linked`
                        : 'No recurring class linked yet'}
                    </div>
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
                        {canDeletePermanent ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                            onClick={() => setDeleteTarget({ id: program.id, title: program.title })}
                          >
                            <Trash2 className="h-4 w-4" /> Delete permanently
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
                {expanded ? (
                  <div className="mt-4 space-y-4">
                    <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-blue-900">Scheduled classes</div>
                      {scheduleMappings.length ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {scheduleMappings.map((mapping) => (
                            <span key={mapping.id} className="rounded-full border border-blue-100 bg-white px-2.5 py-1 text-xs text-blue-950">
                              {mapping.class_name_snapshot} · {mappingLabel(mapping, classTemplateById.get(mapping.class_template_id))}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-2 text-sm text-blue-900">No recurring Schedule class is linked to this program yet.</div>
                      )}
                    </div>
                    <div>{renderAssignedCurriculum(program)}</div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      <ConfirmActionModal
        open={Boolean(statusTarget)}
        title={statusTarget?.nextStatus === 'published' ? 'Publish training program?' : statusTarget?.nextStatus === 'draft' ? 'Unpublish training program?' : 'Archive training program?'}
        description={statusTarget?.nextStatus === 'published' ? 'The program will become visible to its coaching team and will automatically link to eligible scheduled sessions for the selected recurring classes.' : statusTarget?.nextStatus === 'draft' ? 'Future no-log session links from this program will be removed, and the coaching team will no longer see it in My Programs.' : 'Archived programs are kept for history. Future no-log session links are removed while historical session records stay preserved.'}
        confirmLabel={statusTarget?.nextStatus === 'published' ? 'Publish' : statusTarget?.nextStatus === 'draft' ? 'Unpublish' : 'Archive'}
        tone={statusTarget?.nextStatus === 'archived' ? 'destructive' : 'default'}
        pending={pending}
        summaryItems={statusTarget ? [{ label: 'Program', value: statusTarget.title }] : []}
        onCancel={() => !pending && setStatusTarget(null)}
        onConfirm={applyStatus}
      />

      <ConfirmActionModal
        open={Boolean(deleteTarget)}
        title="Permanently delete this test program?"
        description="ATOM will delete the program only if it has never been assigned to a scheduled session and has no training-session history."
        confirmLabel="Delete permanently"
        pendingLabel="Deleting…"
        tone="destructive"
        pending={pending}
        summaryItems={deleteTarget ? [{ label: 'Program', value: deleteTarget.title }] : []}
        warning="Permanent deletion cannot be undone. Program curriculum items will be removed with the unused program. Use Archive for real history."
        onCancel={() => !pending && setDeleteTarget(null)}
        onConfirm={confirmPermanentDelete}
      />
    </div>
  )
}
