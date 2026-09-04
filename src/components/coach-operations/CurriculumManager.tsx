'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Plus, Pencil, Archive, RotateCcw } from 'lucide-react'
import Button from '@/components/ui/Button'
import ConfirmActionModal from '@/components/ui/ConfirmActionModal'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'

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

async function readJson(response: Response) {
  const data = await response.json().catch(() => null)
  return data && typeof data === 'object' ? (data as Record<string, any>) : {}
}

export default function CurriculumManager({
  canManage,
  types,
  blocks,
  techniques,
  situations,
}: {
  canManage: boolean
  types: CurriculumType[]
  blocks: CurriculumBlock[]
  techniques: CurriculumTechnique[]
  situations: CurriculumSituation[]
}) {
  const router = useRouter()
  const [formTarget, setFormTarget] = React.useState<FormTarget | null>(null)
  const [toggleTarget, setToggleTarget] = React.useState<ToggleTarget | null>(null)
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
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
    setOpponentReaction('')
    setCoachingResponse('')
    setSortOrder('100')
  }

  function openEdit(entity: Entity, item: AnyItem) {
    resetFeedback()
    setFormTarget({ mode: 'edit', entity, item })
    setName(item.name)
    setDescription(itemDescription(entity, item))
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
          opponentReaction,
          coachingResponse,
          sortOrder,
        }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) {
        if (data.error === 'DUPLICATE_NAME') throw new Error('That name already exists at this level.')
        if (data.error === 'OPPONENT_REACTION_REQUIRED') throw new Error('Opponent reaction is required.')
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

  const activeBlockCount = blocks.filter((item) => item.is_active).length
  const activeTechniqueCount = techniques.filter((item) => item.is_active).length
  const activeSituationCount = situations.filter((item) => item.is_active).length

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryCard label="Technical types" value={types.filter((item) => item.is_active).length} />
        <SummaryCard label="Blocks" value={activeBlockCount} />
        <SummaryCard label="Techniques" value={activeTechniqueCount} />
        <SummaryCard label="Situations" value={activeSituationCount} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Curriculum library</h2>
          <p className="text-sm text-[hsl(var(--muted))]">
            {canManage
              ? 'Build the shared curriculum. Archive items instead of deleting history.'
              : 'Read-only curriculum shared by the Head Coach.'}
          </p>
        </div>
        {canManage ? (
          <Button type="button" onClick={() => openCreate('type')}>
            <Plus className="h-4 w-4" /> Add technical type
          </Button>
        ) : null}
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
                        openCreate={openCreate}
                        openEdit={openEdit}
                        setToggleTarget={setToggleTarget}
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
    </div>
  )
}

function BlockTree({
  block,
  canManage,
  techniques,
  situations,
  openCreate,
  openEdit,
  setToggleTarget,
}: {
  block: CurriculumBlock
  canManage: boolean
  techniques: CurriculumTechnique[]
  situations: CurriculumSituation[]
  openCreate: (entity: Entity, parentId?: string, parentLabel?: string) => void
  openEdit: (entity: Entity, item: AnyItem) => void
  setToggleTarget: (target: ToggleTarget) => void
}) {
  const blockTechniques = techniques.filter(
    (technique) => technique.block_id === block.id && (canManage || technique.is_active),
  )

  return (
    <details open className={`group rounded-2xl border bg-[hsl(var(--bg))]/40 ${block.is_active ? 'border-[hsl(var(--border))]' : 'border-slate-200 opacity-75'}`}>
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-3 sm:p-4 [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-start gap-2">
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 transition group-open:rotate-180" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold">{block.name}</h4>
              <StatusBadge active={block.is_active} />
            </div>
            {block.description ? <p className="mt-1 text-sm text-[hsl(var(--muted))]">{block.description}</p> : null}
          </div>
        </div>
      </summary>

      <div className="border-t border-[hsl(var(--border))] p-3 sm:p-4">
        {canManage ? (
          <div className="mb-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => openCreate('technique', block.id, block.name)}>
              <Plus className="h-4 w-4" /> Technique
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => openEdit('block', block)}>
              <Pencil className="h-4 w-4" /> Edit block
            </Button>
            <ArchiveButton entity="block" item={block} onClick={setToggleTarget} />
          </div>
        ) : null}

        {blockTechniques.length === 0 ? (
          <EmptyState label="No techniques in this block yet." compact />
        ) : (
          <div className="space-y-3">
            {blockTechniques.map((technique) => (
              <TechniqueTree
                key={technique.id}
                technique={technique}
                canManage={canManage}
                situations={situations}
                openCreate={openCreate}
                openEdit={openEdit}
                setToggleTarget={setToggleTarget}
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
  situations,
  openCreate,
  openEdit,
  setToggleTarget,
}: {
  technique: CurriculumTechnique
  canManage: boolean
  situations: CurriculumSituation[]
  openCreate: (entity: Entity, parentId?: string, parentLabel?: string) => void
  openEdit: (entity: Entity, item: AnyItem) => void
  setToggleTarget: (target: ToggleTarget) => void
}) {
  const techniqueSituations = situations.filter(
    (situation) => situation.technique_id === technique.id && (canManage || situation.is_active),
  )

  return (
    <div className={`rounded-2xl border bg-white p-3 sm:p-4 ${technique.is_active ? 'border-[hsl(var(--border))]' : 'border-slate-200 opacity-75'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h5 className="font-semibold">{technique.name}</h5>
            <StatusBadge active={technique.is_active} />
          </div>
          {technique.description ? <p className="mt-1 text-sm text-[hsl(var(--muted))]">{technique.description}</p> : null}
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => openCreate('situation', technique.id, technique.name)}>
              <Plus className="h-4 w-4" /> Situation
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => openEdit('technique', technique)}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
            <ArchiveButton entity="technique" item={technique} onClick={setToggleTarget} />
          </div>
        ) : null}
      </div>

      <div className="mt-3 space-y-2">
        {techniqueSituations.length === 0 ? (
          <EmptyState label="No opponent-reaction situations yet." compact />
        ) : (
          techniqueSituations.map((situation) => (
            <div key={situation.id} className={`rounded-2xl border px-3 py-3 ${situation.is_active ? 'border-[hsl(var(--border))] bg-[hsl(var(--bg))]/30' : 'border-slate-200 bg-slate-50 opacity-75'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium">{situation.name}</div>
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
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
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
