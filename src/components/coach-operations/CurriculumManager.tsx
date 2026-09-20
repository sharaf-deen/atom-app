'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Plus, Pencil, Archive, RotateCcw, Trash2 } from 'lucide-react'
import Button from '@/components/ui/Button'
import ConfirmActionModal from '@/components/ui/ConfirmActionModal'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'

type TechnicalLevel = 'beginner' | 'intermediate' | 'advanced'
type School = 'old_school' | 'new_school'
type TrainingFormat = 'gi' | 'nogi' | 'both'
type FormatFilter = 'all' | 'gi' | 'nogi'

function formatLabel(value: TrainingFormat | null) {
  if (value === 'gi') return 'Gi'
  if (value === 'nogi') return 'NoGi'
  if (value === 'both') return 'Gi & NoGi'
  return 'Format to review'
}

function matchesFormat(value: TrainingFormat | null, filter: FormatFilter) {
  return filter === 'all' || value === 'both' || value === filter
}

type CurriculumType = {
  id: string
  name: string
  slug: string
  description: string | null
  sort_order: number
  is_active: boolean
}

type CurriculumBlock = {
  id: string
  type_id: string
  name: string
  description: string | null
  sort_order: number
  is_active: boolean
}

type CurriculumTechnique = {
  id: string
  block_id: string
  name: string
  description: string | null
  technical_level: TechnicalLevel
  school: School | null
  training_format: TrainingFormat | null
  sort_order: number
  is_active: boolean
}

type CurriculumSituation = {
  id: string
  technique_id: string
  name: string
  opponent_reaction: string
  coaching_response: string | null
  training_format: TrainingFormat | null
  sort_order: number
  is_active: boolean
}

type Entity = 'type' | 'block' | 'technique' | 'situation'
type AnyItem = CurriculumType | CurriculumBlock | CurriculumTechnique | CurriculumSituation

type FormTarget = {
  mode: 'create' | 'edit'
  entity: Entity
  parentId?: string
  parentLabel?: string
  item?: AnyItem
}

type ToggleTarget = {
  entity: Entity
  id: string
  name: string
  isActive: boolean
}

type DeleteTarget = {
  entity: Entity
  id: string
  name: string
}

function badgeClass(active: boolean) {
  return active
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : 'border-slate-200 bg-slate-100 text-slate-600'
}

function entityLabel(entity: Entity) {
  if (entity === 'type') return 'technical type'
  if (entity === 'block') return 'technical block'
  if (entity === 'technique') return 'technique'
  return 'situation / reaction'
}

function itemDescription(entity: Entity, item?: AnyItem) {
  if (!item) return ''
  if (entity === 'situation') return ''
  return String((item as CurriculumType | CurriculumBlock | CurriculumTechnique).description ?? '')
}

function situationReaction(item?: AnyItem) {
  if (!item || !('opponent_reaction' in item)) return ''
  return item.opponent_reaction ?? ''
}

function situationResponse(item?: AnyItem) {
  if (!item || !('coaching_response' in item)) return ''
  return item.coaching_response ?? ''
}

function techniqueLevel(item?: AnyItem): TechnicalLevel {
  if (!item || !('technical_level' in item)) return 'beginner'
  const level = String(item.technical_level ?? '').toLowerCase()
  return level === 'intermediate' || level === 'advanced' ? level : 'beginner'
}

function levelLabel(level: TechnicalLevel) {
  if (level === 'beginner') return 'Beginner'
  if (level === 'intermediate') return 'Intermediate'
  return 'Advanced'
}

function levelBadgeClass(level: TechnicalLevel) {
  if (level === 'beginner') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (level === 'intermediate') return 'border-amber-200 bg-amber-50 text-amber-800'
  return 'border-rose-200 bg-rose-50 text-rose-800'
}

function techniqueSchool(item?: AnyItem): School | '' {
  if (!item || !('school' in item)) return ''
  return item.school === 'old_school' || item.school === 'new_school' ? item.school : ''
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => null)
  return data && typeof data === 'object' ? (data as Record<string, any>) : {}
}

export default function CurriculumManager({
  canManage,
  canDeletePermanent,
  types,
  blocks,
  techniques,
  situations,
}: {
  canManage: boolean
  canDeletePermanent: boolean
  types: CurriculumType[]
  blocks: CurriculumBlock[]
  techniques: CurriculumTechnique[]
  situations: CurriculumSituation[]
}) {
  const router = useRouter()
  const [formTarget, setFormTarget] = React.useState<FormTarget | null>(null)
  const [toggleTarget, setToggleTarget] = React.useState<ToggleTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<DeleteTarget | null>(null)
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [technicalLevel, setTechnicalLevel] = React.useState<TechnicalLevel>('beginner')
  const [school, setSchool] = React.useState<School | ''>('')
  const [trainingFormat, setTrainingFormat] = React.useState<TrainingFormat | ''>('')
  const [formatFilter, setFormatFilter] = React.useState<FormatFilter>('all')
  const [opponentReaction, setOpponentReaction] = React.useState('')
  const [coachingResponse, setCoachingResponse] = React.useState('')
  const [sortOrder, setSortOrder] = React.useState('100')
  const [pending, setPending] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const visibleTypes = React.useMemo(
    () => (canManage ? types : types.filter((item) => item.is_active)),
    [canManage, types],
  )

  function resetFeedback() {
    setMessage(null)
    setError(null)
  }

  function openCreate(entity: Entity, parentId?: string, parentLabel?: string) {
    resetFeedback()
    setFormTarget({ mode: 'create', entity, parentId, parentLabel })
    setName('')
    setDescription('')
    setTechnicalLevel('beginner')
    setSchool('')
    if (entity === 'situation') {
      const parentFormat = techniques.find((item) => item.id === parentId)?.training_format
      setTrainingFormat(parentFormat === 'gi' || parentFormat === 'nogi' ? parentFormat : '')
    } else {
      setTrainingFormat('')
    }
    setOpponentReaction('')
    setCoachingResponse('')
    setSortOrder('100')
  }

  function openEdit(entity: Entity, item: AnyItem) {
    resetFeedback()
    setFormTarget({ mode: 'edit', entity, item })
    setName(item.name)
    setDescription(itemDescription(entity, item))
    setTechnicalLevel(entity === 'technique' ? techniqueLevel(item) : 'beginner')
    setSchool(entity === 'technique' ? techniqueSchool(item) : '')
    setTrainingFormat('training_format' in item ? item.training_format ?? '' : '')
    setOpponentReaction(situationReaction(item))
    setCoachingResponse(situationResponse(item))
    setSortOrder(String(item.sort_order ?? 100))
  }

  function closeForm() {
    if (pending) return
    setFormTarget(null)
  }

  async function submitForm(event: React.FormEvent) {
    event.preventDefault()
    if (!formTarget) return
    resetFeedback()

    const cleanName = name.replace(/\s+/g, ' ').trim()
    if (cleanName.length < 2) {
      setError('Enter a name of at least 2 characters.')
      return
    }
    if (formTarget.entity === 'situation' && opponentReaction.trim().length < 2) {
      setError('Describe the opponent reaction for this situation.')
      return
    }
    if (formTarget.entity === 'technique' && !school) {
      setError('Choose Old School or New School for this technique.')
      return
    }
    if ((formTarget.entity === 'technique' || formTarget.entity === 'situation') && !trainingFormat) {
      setError('Choose Gi, NoGi or both.')
      return
    }

    setPending(true)
    try {
      const response = await fetch('/api/coach-operations/curriculum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: formTarget.mode === 'create' ? 'create' : 'update',
          entity: formTarget.entity,
          id: formTarget.item?.id,
          parentId: formTarget.parentId,
          name: cleanName,
          description,
          technicalLevel: formTarget.entity === 'technique' ? technicalLevel : undefined,
          school: formTarget.entity === 'technique' ? school : undefined,
          trainingFormat: formTarget.entity === 'technique' || formTarget.entity === 'situation' ? trainingFormat : undefined,
          opponentReaction,
          coachingResponse,
          sortOrder,
        }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        if (data.error === 'DUPLICATE_NAME') throw new Error('That name already exists at this level.')
        if (data.error === 'OPPONENT_REACTION_REQUIRED') throw new Error('Opponent reaction is required.')
        if (data.error === 'INVALID_TECHNICAL_LEVEL') throw new Error('Choose Beginner, Intermediate or Advanced.')
        if (data.error === 'INVALID_SCHOOL') throw new Error('Choose Old School or New School.')
        if (data.error === 'INVALID_TRAINING_FORMAT') throw new Error('Choose Gi, NoGi or both.')
        if (data.error === 'SITUATION_FORMAT_MISMATCH') throw new Error('This situation format is not available for the parent technique.')
        if (data.error === 'TECHNIQUE_FORMAT_IN_USE') throw new Error('Review the existing situations before changing this technique format.')
        if (data.error === 'CLOTHING_GRIP_REQUIRES_GI') throw new Error('Gi clothing grips belong in a Gi-only situation. Write a separate NoGi reaction without clothing grips.')
        if (data.error === 'TECHNIQUE_LEVEL_IN_USE') throw new Error(data.details || 'This technique is assigned to a lower-level program.')
        throw new Error(data.details || data.error || 'Failed to save curriculum item.')
      }

      setMessage(`${cleanName} saved.`)
      setFormTarget(null)
      router.refresh()
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setPending(false)
    }
  }

  async function confirmToggle() {
    if (!toggleTarget) return
    resetFeedback()
    setPending(true)
    try {
      const response = await fetch('/api/coach-operations/curriculum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'set_active',
          entity: toggleTarget.entity,
          id: toggleTarget.id,
          isActive: !toggleTarget.isActive,
        }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        throw new Error(data.details || data.error || 'Failed to update curriculum item.')
      }

      setMessage(`${toggleTarget.name} ${toggleTarget.isActive ? 'archived' : 'restored'}.`)
      setToggleTarget(null)
      router.refresh()
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setPending(false)
    }
  }

  async function confirmPermanentDelete() {
    if (!deleteTarget || !canDeletePermanent) return
    resetFeedback()
    setPending(true)
    try {
      const response = await fetch('/api/coach-operations/curriculum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'delete_permanent',
          entity: deleteTarget.entity,
          id: deleteTarget.id,
        }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        throw new Error(data.details || data.error || 'Permanent delete was blocked.')
      }

      setMessage(`${deleteTarget.name} permanently deleted.`)
      setDeleteTarget(null)
      router.refresh()
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setPending(false)
    }
  }

  const activeBlockCount = blocks.filter((item) => item.is_active).length
  const activeTechniqueCount = techniques.filter((item) => item.is_active).length
  const activeSituationCount = situations.filter((item) => item.is_active).length
  const situationsByTechnique = new Map<string, number>()
  situations.filter((item) => item.is_active).forEach((item) => {
    situationsByTechnique.set(item.technique_id, (situationsByTechnique.get(item.technique_id) ?? 0) + 1)
  })
  const techniquesNeedingSituations = techniques.filter(
    (item) => item.is_active && (situationsByTechnique.get(item.id) ?? 0) < 2,
  ).length

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryCard label="Technical types" value={types.filter((item) => item.is_active).length} />
        <SummaryCard label="Blocks" value={activeBlockCount} />
        <SummaryCard label="Techniques" value={activeTechniqueCount} />
        <SummaryCard label="Situations" value={activeSituationCount} />
      </div>
      {canManage && techniquesNeedingSituations > 0 ? (
        <p className="text-sm text-amber-800">
          {techniquesNeedingSituations} active technique{techniquesNeedingSituations === 1 ? '' : 's'} need a second active opponent reaction.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Curriculum library</h2>
          <p className="text-sm text-[hsl(var(--muted))]">
            {canManage
              ? canDeletePermanent
                ? 'Build the shared curriculum. Archive preserves real history; unused test data can be permanently deleted.'
                : 'Build the shared curriculum. Archive items instead of deleting history.'
              : 'Read-only curriculum shared by the Head Coach.'}
          </p>
        </div>
        {canManage ? (
          <Button type="button" onClick={() => openCreate('type')}>
            <Plus className="h-4 w-4" /> Add technical type
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2" aria-label="Filter curriculum by training format">
        <span className="mr-1 text-sm font-medium">Training format:</span>
        {(['all', 'gi', 'nogi'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFormatFilter(value)}
            aria-pressed={formatFilter === value}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${formatFilter === value ? 'border-black bg-black text-white' : 'border-[hsl(var(--border))] bg-white text-black'}`}
          >
            {value === 'all' ? 'All' : value === 'gi' ? 'Gi' : 'NoGi'}
          </button>
        ))}
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

      {formTarget ? (
        <form onSubmit={submitForm} className="rounded-3xl border border-black/10 bg-white p-4 shadow-soft sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
                {formTarget.mode === 'create' ? 'Add' : 'Edit'} {entityLabel(formTarget.entity)}
              </div>
              <h3 className="mt-1 text-lg font-semibold">
                {formTarget.parentLabel ? `Under ${formTarget.parentLabel}` : 'Training curriculum'}
              </h3>
            </div>
            <Button type="button" variant="ghost" onClick={closeForm} disabled={pending}>
              Close
            </Button>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Input
              label={formTarget.entity === 'situation' ? 'Situation name' : 'Name'}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={
                formTarget.entity === 'block'
                  ? 'e.g. Half Guard Passing'
                  : formTarget.entity === 'technique'
                    ? 'e.g. Knee Cut Pass'
                    : formTarget.entity === 'situation'
                      ? 'e.g. Opponent frames and turns away'
                      : 'e.g. Guard Retention'
              }
              required
            />
            <Input
              label="Display order"
              type="number"
              min={0}
              max={10000}
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
              hint="Lower numbers appear first."
            />
          </div>

          {formTarget.entity === 'technique' ? (
            <div className="mt-4 flex flex-wrap gap-4">
              <label className="block min-w-[230px] flex-1">
                <span className="mb-1.5 block text-sm font-semibold text-black">Technical level</span>
                <select
                  value={technicalLevel}
                  onChange={(event) => setTechnicalLevel(event.target.value as TechnicalLevel)}
                  className="min-h-[44px] w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3.5 py-2.5 text-sm text-black shadow-soft outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-xs"
                >
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                </select>
                <span className="mt-1 block text-xs text-[hsl(var(--muted))]">
                  Situations inherit this level from their parent technique.
                </span>
              </label>
              <label className="block min-w-[230px] flex-1">
                <span className="mb-1.5 block text-sm font-semibold text-black">School</span>
                <select
                  value={school}
                  onChange={(event) => setSchool(event.target.value as School | '')}
                  required
                  className="min-h-[44px] w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3.5 py-2.5 text-sm text-black shadow-soft outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-xs"
                >
                  <option value="">Choose a school</option>
                  <option value="old_school">Old School</option>
                  <option value="new_school">New School</option>
                </select>
                <span className="mt-1 block text-xs text-[hsl(var(--muted))]">
                  Existing school labels stay unclassified until the Head Coach or Super Admin reviews them.
                </span>
              </label>
            </div>
          ) : null}

          {formTarget.entity === 'technique' || formTarget.entity === 'situation' ? (
            <label className="mt-4 block">
              <span className="mb-1.5 block text-sm font-semibold text-black">Training format</span>
              <select
                value={trainingFormat}
                onChange={(event) => setTrainingFormat(event.target.value as TrainingFormat | '')}
                required
                className="min-h-[44px] w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3.5 py-2.5 text-sm text-black shadow-soft outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-xs"
              >
                <option value="">Choose a format</option>
                {(['gi', 'nogi', 'both'] as const)
                  .filter((value) => {
                    if (formTarget.entity !== 'situation') return true
                    const parentId = formTarget.mode === 'create'
                      ? formTarget.parentId
                      : (formTarget.item as CurriculumSituation).technique_id
                    const parentFormat = techniques.find((item) => item.id === parentId)?.training_format
                    return parentFormat === 'both' || parentFormat === value
                  })
                  .map((value) => <option key={value} value={value}>{formatLabel(value)}</option>)}
              </select>
              {formTarget.entity === 'situation' ? (
                <span className="mt-1 block text-xs text-[hsl(var(--muted))]">
                  Gi and NoGi can have separate opponent reactions and coaching notes. NoGi notes use body or wrist control, without clothing grips.
                </span>
              ) : null}
            </label>
          ) : null}

          {formTarget.entity === 'situation' ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <Textarea
                label="Opponent reaction"
                value={opponentReaction}
                onChange={(event) => setOpponentReaction(event.target.value)}
                placeholder="What does the opponent do or change?"
                rows={4}
                required
              />
              <Textarea
                label="Coach response / notes"
                value={coachingResponse}
                onChange={(event) => setCoachingResponse(event.target.value)}
                placeholder="Technical response, cue or objective."
                rows={4}
              />
            </div>
          ) : (
            <div className="mt-4">
              <Textarea
                label="Description (optional)"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Short coaching description or objective."
                rows={3}
              />
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <Button type="submit" loading={pending} loadingText="Saving…">
              Save
            </Button>
          </div>
        </form>
      ) : null}

      <div className="space-y-4">
        {visibleTypes.map((type) => {
          const typeBlocks = blocks.filter((block) => block.type_id === type.id && (canManage || block.is_active))
          return (
            <section key={type.id} className={`rounded-3xl border bg-white shadow-soft ${type.is_active ? 'border-[hsl(var(--border))]' : 'border-slate-200 opacity-75'}`}>
              <div className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xl font-semibold tracking-tight">{type.name}</h3>
                      <StatusBadge active={type.is_active} />
                    </div>
                    {type.description ? <p className="mt-1 text-sm text-[hsl(var(--muted))]">{type.description}</p> : null}
                  </div>
                  {canManage ? (
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => openCreate('block', type.id, type.name)}>
                        <Plus className="h-4 w-4" /> Block
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => openEdit('type', type)}>
                        <Pencil className="h-4 w-4" /> Edit
                      </Button>
                      <ArchiveButton entity="type" item={type} onClick={setToggleTarget} />
                      {canDeletePermanent ? (
                        <PermanentDeleteButton entity="type" item={type} onClick={setDeleteTarget} />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="border-t border-[hsl(var(--border))] p-3 sm:p-4">
                {typeBlocks.length === 0 ? (
                  <EmptyState label="No technical blocks yet." />
                ) : (
                  <div className="space-y-3">
                    {typeBlocks.map((block) => (
                      <BlockTree
                        key={block.id}
                        block={block}
                        canManage={canManage}
                        techniques={techniques}
                        situations={situations}
                        formatFilter={formatFilter}
                        openCreate={openCreate}
                        openEdit={openEdit}
                        setToggleTarget={setToggleTarget}
                        canDeletePermanent={canDeletePermanent}
                        setDeleteTarget={setDeleteTarget}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>
          )
        })}

        {visibleTypes.length === 0 ? (
          <EmptyState label="No active curriculum types are available yet." />
        ) : null}
      </div>

      <ConfirmActionModal
        open={Boolean(toggleTarget)}
        title={toggleTarget?.isActive ? 'Archive curriculum item?' : 'Restore curriculum item?'}
        description={
          toggleTarget?.isActive
            ? 'Archived items are hidden from Coach and Assistant Coach read-only views. Existing curriculum history is preserved.'
            : 'The item will become visible again in the shared curriculum.'
        }
        confirmLabel={toggleTarget?.isActive ? 'Archive' : 'Restore'}
        pendingLabel="Saving…"
        tone={toggleTarget?.isActive ? 'destructive' : 'default'}
        pending={pending}
        summaryItems={toggleTarget ? [{ label: 'Item', value: toggleTarget.name }] : []}
        warning="This changes curriculum visibility only. It does not delete the item."
        onCancel={() => !pending && setToggleTarget(null)}
        onConfirm={confirmToggle}
      />

      <ConfirmActionModal
        open={Boolean(deleteTarget)}
        title="Permanently delete this test item?"
        description="ATOM will delete this curriculum item only if it has never been used and has no child items that must be handled first."
        confirmLabel="Delete permanently"
        pendingLabel="Deleting…"
        tone="destructive"
        pending={pending}
        summaryItems={
          deleteTarget
            ? [
                { label: 'Item', value: deleteTarget.name },
                { label: 'Type', value: entityLabel(deleteTarget.entity) },
              ]
            : []
        }
        warning="Permanent deletion cannot be undone. Use Archive for real curriculum history."
        onCancel={() => !pending && setDeleteTarget(null)}
        onConfirm={confirmPermanentDelete}
      />
    </div>
  )
}

function BlockTree({
  block,
  canManage,
  canDeletePermanent,
  techniques,
  situations,
  formatFilter,
  openCreate,
  openEdit,
  setToggleTarget,
  setDeleteTarget,
}: {
  block: CurriculumBlock
  canManage: boolean
  canDeletePermanent: boolean
  techniques: CurriculumTechnique[]
  situations: CurriculumSituation[]
  formatFilter: FormatFilter
  openCreate: (entity: Entity, parentId?: string, parentLabel?: string) => void
  openEdit: (entity: Entity, item: AnyItem) => void
  setToggleTarget: (target: ToggleTarget) => void
  setDeleteTarget: (target: DeleteTarget) => void
}) {
  const blockTechniques = techniques.filter(
    (technique) => technique.block_id === block.id && (canManage || technique.is_active)
      && matchesFormat(technique.training_format, formatFilter),
  )
  const techniqueIds = new Set(blockTechniques.map((technique) => technique.id))
  const blockSituationCount = situations.filter(
    (situation) => techniqueIds.has(situation.technique_id) && (canManage || situation.is_active)
      && matchesFormat(situation.training_format, formatFilter),
  ).length

  return (
    <details
      className={`rounded-2xl border bg-[hsl(var(--bg))]/40 [&[open]>summary_.block-chevron]:rotate-90 ${
        block.is_active ? 'border-[hsl(var(--border))]' : 'border-slate-200 opacity-75'
      }`}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 sm:px-4 [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <ChevronRight className="block-chevron h-4 w-4 shrink-0 transition-transform" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="truncate font-semibold">{block.name}</h4>
              <StatusBadge active={block.is_active} />
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-[hsl(var(--muted))]">
          <span>{blockTechniques.length} technique{blockTechniques.length === 1 ? '' : 's'}</span>
          {blockSituationCount > 0 ? (
            <span className="hidden sm:inline">· {blockSituationCount} situation{blockSituationCount === 1 ? '' : 's'}</span>
          ) : null}
        </div>
      </summary>

      <div className="border-t border-[hsl(var(--border))] p-3 sm:p-4">
        {block.description ? (
          <p className="mb-3 text-sm text-[hsl(var(--muted))]">{block.description}</p>
        ) : null}

        {canManage ? (
          <div className="mb-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => openCreate('technique', block.id, block.name)}>
              <Plus className="h-4 w-4" /> Technique
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => openEdit('block', block)}>
              <Pencil className="h-4 w-4" /> Edit block
            </Button>
            <ArchiveButton entity="block" item={block} onClick={setToggleTarget} />
            {canDeletePermanent ? (
              <PermanentDeleteButton entity="block" item={block} onClick={setDeleteTarget} />
            ) : null}
          </div>
        ) : null}

        {blockTechniques.length === 0 ? (
          <EmptyState label={formatFilter === 'all' ? 'No techniques in this block yet.' : `No ${formatFilter === 'gi' ? 'Gi' : 'NoGi'} techniques in this block.`} compact />
        ) : (
          <div className="space-y-2">
            {blockTechniques.map((technique) => (
              <TechniqueTree
                key={technique.id}
                technique={technique}
                canManage={canManage}
                situations={situations}
                formatFilter={formatFilter}
                openCreate={openCreate}
                openEdit={openEdit}
                setToggleTarget={setToggleTarget}
                canDeletePermanent={canDeletePermanent}
                setDeleteTarget={setDeleteTarget}
              />
            ))}
          </div>
        )}
      </div>
    </details>
  )
}

function TechniqueTree({
  technique,
  canManage,
  canDeletePermanent,
  situations,
  formatFilter,
  openCreate,
  openEdit,
  setToggleTarget,
  setDeleteTarget,
}: {
  technique: CurriculumTechnique
  canManage: boolean
  canDeletePermanent: boolean
  situations: CurriculumSituation[]
  formatFilter: FormatFilter
  openCreate: (entity: Entity, parentId?: string, parentLabel?: string) => void
  openEdit: (entity: Entity, item: AnyItem) => void
  setToggleTarget: (target: ToggleTarget) => void
  setDeleteTarget: (target: DeleteTarget) => void
}) {
  const techniqueSituations = situations.filter(
    (situation) => situation.technique_id === technique.id && (canManage || situation.is_active)
      && matchesFormat(situation.training_format, formatFilter),
  )
  const activeSituationCount = techniqueSituations.filter((situation) => situation.is_active).length

  return (
    <details
      className={`rounded-2xl border bg-white [&[open]>summary_.technique-chevron]:rotate-90 ${
        technique.is_active ? 'border-[hsl(var(--border))]' : 'border-slate-200 opacity-75'
      }`}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <ChevronRight className="technique-chevron h-4 w-4 shrink-0 transition-transform" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h5 className="truncate font-semibold">{technique.name}</h5>
              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${levelBadgeClass(technique.technical_level)}`}>
                {levelLabel(technique.technical_level)}
              </span>
              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${technique.school === 'new_school' ? 'border-indigo-200 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                {technique.school === 'new_school' ? 'New School' : technique.school === 'old_school' ? 'Old School' : 'School to classify'}
              </span>
              <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                {formatLabel(technique.training_format)}
              </span>
              <StatusBadge active={technique.is_active} />
            </div>
          </div>
        </div>
        <span className={`shrink-0 text-xs ${canManage && technique.is_active && activeSituationCount < 2 ? 'font-semibold text-amber-800' : 'text-[hsl(var(--muted))]'}`}>
          {activeSituationCount} active situation{activeSituationCount === 1 ? '' : 's'}
        </span>
      </summary>

      <div className="border-t border-[hsl(var(--border))] p-3 sm:p-4">
        {technique.description ? (
          <p className="mb-3 text-sm text-[hsl(var(--muted))]">{technique.description}</p>
        ) : null}

        {canManage ? (
          <div className="mb-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => openCreate('situation', technique.id, technique.name)}>
              <Plus className="h-4 w-4" /> Situation
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => openEdit('technique', technique)}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
            <ArchiveButton entity="technique" item={technique} onClick={setToggleTarget} />
            {canDeletePermanent ? (
              <PermanentDeleteButton entity="technique" item={technique} onClick={setDeleteTarget} />
            ) : null}
          </div>
        ) : null}

        {techniqueSituations.length === 0 ? (
          <EmptyState label="No opponent-reaction situations yet." compact />
        ) : (
          <div className="space-y-2">
            {techniqueSituations.map((situation) => (
              <div
                key={situation.id}
                className={`rounded-2xl border px-3 py-3 ${
                  situation.is_active
                    ? 'border-[hsl(var(--border))] bg-[hsl(var(--bg))]/30'
                    : 'border-slate-200 bg-slate-50 opacity-75'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium">{situation.name}</div>
                      <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                        {formatLabel(situation.training_format)}
                      </span>
                      <StatusBadge active={situation.is_active} />
                    </div>
                    <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Opponent reaction</div>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm">{situation.opponent_reaction}</p>
                    {situation.coaching_response ? (
                      <>
                        <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Coach response / notes</div>
                        <p className="mt-0.5 whitespace-pre-wrap text-sm">{situation.coaching_response}</p>
                      </>
                    ) : null}
                  </div>
                  {canManage ? (
                    <div className="flex gap-1">
                      <Button type="button" size="sm" variant="ghost" onClick={() => openEdit('situation', situation)}>
                        <Pencil className="h-4 w-4" /> Edit
                      </Button>
                      <ArchiveButton entity="situation" item={situation} onClick={setToggleTarget} />
                      {canDeletePermanent ? (
                        <PermanentDeleteButton entity="situation" item={situation} onClick={setDeleteTarget} />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  )
}

function PermanentDeleteButton({
  entity,
  item,
  onClick,
}: {
  entity: Entity
  item: AnyItem
  onClick: (target: DeleteTarget) => void
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"
      onClick={() => onClick({ entity, id: item.id, name: item.name })}
    >
      <Trash2 className="h-4 w-4" /> Delete permanently
    </Button>
  )
}

function ArchiveButton({
  entity,
  item,
  onClick,
}: {
  entity: Entity
  item: AnyItem
  onClick: (target: ToggleTarget) => void
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={() => onClick({ entity, id: item.id, name: item.name, isActive: item.is_active })}
    >
      {item.is_active ? <Archive className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
      {item.is_active ? 'Archive' : 'Restore'}
    </Button>
  )
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badgeClass(active)}`}>
      {active ? 'Active' : 'Archived'}
    </span>
  )
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-3 shadow-soft">
      <div className="text-xs font-medium text-[hsl(var(--muted))]">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  )
}

function EmptyState({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div className={`rounded-2xl border border-dashed border-[hsl(var(--border))] text-center text-sm text-[hsl(var(--muted))] ${compact ? 'px-3 py-3' : 'px-4 py-6'}`}>
      {label}
    </div>
  )
}
