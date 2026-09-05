'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Archive, CalendarDays, Pencil, Plus, RotateCcw } from 'lucide-react'
import Button from '@/components/ui/Button'
import ConfirmActionModal from '@/components/ui/ConfirmActionModal'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import type { ScheduleClassTemplate } from '@/app/schedule/templates/page'

type Audience = ScheduleClassTemplate['audience']
type ActivityType = ScheduleClassTemplate['activity_type']
type Uniform = ScheduleClassTemplate['uniform']

type StatusTarget = {
  id: string
  name: string
  nextActive: boolean
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const selectClass =
  'h-10 w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 text-sm text-black outline-none focus:border-black'

function todayIso() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

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

function formatDate(value: string | null) {
  if (!value) return 'Open-ended'
  const date = new Date(`${value}T12:00:00`)
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function audienceLabel(value: Audience) {
  if (value === 'kids_teens') return 'Kids & Teens'
  if (value === 'adults') return 'Adults'
  return 'All'
}

function activityLabel(value: ActivityType) {
  const labels: Record<ActivityType, string> = {
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

function uniformLabel(value: Uniform) {
  const labels: Record<Uniform, string> = {
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

export default function ClassTemplatesManager({
  canManage,
  templates,
}: {
  canManage: boolean
  templates: ScheduleClassTemplate[]
}) {
  const router = useRouter()
  const [showInactive, setShowInactive] = React.useState(false)
  const [formOpen, setFormOpen] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [name, setName] = React.useState('')
  const [audience, setAudience] = React.useState<Audience>('adults')
  const [ageMin, setAgeMin] = React.useState('')
  const [ageMax, setAgeMax] = React.useState('')
  const [level, setLevel] = React.useState('All Levels')
  const [activityType, setActivityType] = React.useState<ActivityType>('jiu_jitsu')
  const [uniform, setUniform] = React.useState<Uniform>('gi')
  const [dayOfWeek, setDayOfWeek] = React.useState(0)
  const [startTime, setStartTime] = React.useState('18:00')
  const [endTime, setEndTime] = React.useState('')
  const [mat, setMat] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [effectiveFrom, setEffectiveFrom] = React.useState(todayIso())
  const [effectiveUntil, setEffectiveUntil] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [statusTarget, setStatusTarget] = React.useState<StatusTarget | null>(null)

  const visibleTemplates = templates.filter((row) => showInactive || row.is_active)
  const activeCount = templates.filter((row) => row.is_active).length
  const inactiveCount = templates.length - activeCount

  function resetFeedback() {
    setMessage(null)
    setError(null)
  }

  function openNew() {
    resetFeedback()
    setEditingId(null)
    setName('')
    setAudience('adults')
    setAgeMin('')
    setAgeMax('')
    setLevel('All Levels')
    setActivityType('jiu_jitsu')
    setUniform('gi')
    setDayOfWeek(0)
    setStartTime('18:00')
    setEndTime('')
    setMat('')
    setNotes('')
    setEffectiveFrom(todayIso())
    setEffectiveUntil('')
    setFormOpen(true)
  }

  function openEdit(row: ScheduleClassTemplate) {
    resetFeedback()
    setEditingId(row.id)
    setName(row.name)
    setAudience(row.audience)
    setAgeMin(row.age_min == null ? '' : String(row.age_min))
    setAgeMax(row.age_max == null ? '' : String(row.age_max))
    setLevel(row.level)
    setActivityType(row.activity_type)
    setUniform(row.uniform)
    setDayOfWeek(row.day_of_week)
    setStartTime(normalizeTime(row.start_time))
    setEndTime(normalizeTime(row.end_time))
    setMat(row.mat ?? '')
    setNotes(row.notes ?? '')
    setEffectiveFrom(row.effective_from)
    setEffectiveUntil(row.effective_until ?? '')
    setFormOpen(true)
  }

  async function saveTemplate(event: React.FormEvent) {
    event.preventDefault()
    resetFeedback()

    const cleanName = name.replace(/\s+/g, ' ').trim()
    const cleanLevel = level.replace(/\s+/g, ' ').trim()
    if (cleanName.length < 2) return setError('Enter a class name.')
    if (cleanLevel.length < 2) return setError('Enter a level.')
    if (!startTime) return setError('Choose a start time.')
    if (!effectiveFrom) return setError('Choose an effective-from date.')
    if ((ageMin && !ageMax) || (!ageMin && ageMax)) return setError('Enter both minimum and maximum age, or leave both empty.')

    setPending(true)
    try {
      const response = await fetch('/api/schedule/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'save',
          id: editingId,
          name: cleanName,
          audience,
          ageMin: ageMin || null,
          ageMax: ageMax || null,
          level: cleanLevel,
          activityType,
          uniform,
          dayOfWeek,
          startTime,
          endTime: endTime || null,
          mat,
          notes,
          effectiveFrom,
          effectiveUntil: effectiveUntil || null,
        }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) throw new Error(data.details || data.error || 'Failed to save class template.')

      setMessage(editingId ? 'Class template updated.' : 'Class template created.')
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
      const response = await fetch('/api/schedule/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'set_active', id: statusTarget.id, active: statusTarget.nextActive }),
      })
      const data = await readJson(response)
      if (!response.ok || data.ok !== true) throw new Error(data.details || data.error || 'Failed to update class template.')
      setMessage(statusTarget.nextActive ? 'Class template restored.' : 'Class template archived.')
      setStatusTarget(null)
      router.refresh()
    } catch (cause: any) {
      setError(String(cause?.message || cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
          <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Active templates</div>
          <div className="mt-1 text-2xl font-bold">{activeCount}</div>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
          <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Archived</div>
          <div className="mt-1 text-2xl font-bold">{inactiveCount}</div>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
          <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Structured sessions</div>
          <div className="mt-1 text-sm font-semibold">Not generated in Lot 2A</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(event) => setShowInactive(event.target.checked)}
            className="h-4 w-4 rounded border-[hsl(var(--border))]"
          />
          Show archived templates
        </label>
        {canManage ? (
          <Button type="button" onClick={openNew}>
            <Plus className="h-4 w-4" /> New class template
          </Button>
        ) : null}
      </div>

      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div> : null}
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}

      {formOpen ? (
        <form onSubmit={saveTemplate} className="space-y-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">{editingId ? 'Edit class template' : 'New class template'}</h2>
              <p className="text-sm text-[hsl(var(--muted))]">One template represents one recurring weekly class occurrence.</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => !pending && setFormOpen(false)}>
              Close
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium md:col-span-2">
              <span>Class name</span>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Kids 6–9 Beginners" maxLength={180} />
            </label>

            <label className="space-y-1.5 text-sm font-medium">
              <span>Audience</span>
              <select value={audience} onChange={(event) => setAudience(event.target.value as Audience)} className={selectClass}>
                <option value="kids_teens">Kids & Teens</option>
                <option value="adults">Adults</option>
                <option value="all">All</option>
              </select>
            </label>

            <label className="space-y-1.5 text-sm font-medium">
              <span>Level</span>
              <Input value={level} onChange={(event) => setLevel(event.target.value)} placeholder="Beginners" maxLength={100} />
            </label>

            <label className="space-y-1.5 text-sm font-medium">
              <span>Minimum age</span>
              <Input type="number" min={0} max={99} value={ageMin} onChange={(event) => setAgeMin(event.target.value)} placeholder="Optional" />
            </label>

            <label className="space-y-1.5 text-sm font-medium">
              <span>Maximum age</span>
              <Input type="number" min={0} max={99} value={ageMax} onChange={(event) => setAgeMax(event.target.value)} placeholder="Optional" />
            </label>

            <label className="space-y-1.5 text-sm font-medium">
              <span>Activity</span>
              <select value={activityType} onChange={(event) => setActivityType(event.target.value as ActivityType)} className={selectClass}>
                <option value="jiu_jitsu">Jiu-Jitsu</option>
                <option value="competition">Competition</option>
                <option value="open_drills">Open Drills</option>
                <option value="open_mat">Open Mat</option>
                <option value="physical_preparation">Physical Preparation</option>
                <option value="wrestling">Wrestling</option>
                <option value="other">Other</option>
              </select>
            </label>

            <label className="space-y-1.5 text-sm font-medium">
              <span>Uniform</span>
              <select value={uniform} onChange={(event) => setUniform(event.target.value as Uniform)} className={selectClass}>
                <option value="gi">Gi</option>
                <option value="nogi">NoGi</option>
                <option value="gi_nogi">Gi & NoGi</option>
                <option value="none">Not specified</option>
              </select>
            </label>

            <label className="space-y-1.5 text-sm font-medium">
              <span>Day</span>
              <select value={dayOfWeek} onChange={(event) => setDayOfWeek(Number(event.target.value))} className={selectClass}>
                {DAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
              </select>
            </label>

            <label className="space-y-1.5 text-sm font-medium">
              <span>Mat</span>
              <Input value={mat} onChange={(event) => setMat(event.target.value)} placeholder="Mat 1 · optional" maxLength={80} />
            </label>

            <label className="space-y-1.5 text-sm font-medium">
              <span>Start time</span>
              <Input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
            </label>

            <label className="space-y-1.5 text-sm font-medium">
              <span>End time</span>
              <Input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
              <span className="block text-xs font-normal text-[hsl(var(--muted))]">Optional because the current public timetable publishes start times only.</span>
            </label>

            <label className="space-y-1.5 text-sm font-medium">
              <span>Effective from</span>
              <Input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
            </label>

            <label className="space-y-1.5 text-sm font-medium">
              <span>Effective until</span>
              <Input type="date" value={effectiveUntil} onChange={(event) => setEffectiveUntil(event.target.value)} />
            </label>

            <label className="space-y-1.5 text-sm font-medium md:col-span-2">
              <span>Internal notes</span>
              <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} maxLength={2000} placeholder="Optional operational note. Never shown to members in Lot 2A." />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>{pending ? 'Saving…' : editingId ? 'Save changes' : 'Create template'}</Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setFormOpen(false)}>Cancel</Button>
          </div>
        </form>
      ) : null}

      <div className="space-y-5">
        {DAYS.map((day, dayIndex) => {
          const rows = visibleTemplates.filter((row) => row.day_of_week === dayIndex)
          if (!rows.length) return null
          return (
            <section key={day} className="space-y-2">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4" />
                <h2 className="font-semibold">{day}</h2>
                <span className="text-xs text-[hsl(var(--muted))]">{rows.length} template{rows.length === 1 ? '' : 's'}</span>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                {rows.map((row) => (
                  <article key={row.id} className={`rounded-2xl border p-4 shadow-soft ${row.is_active ? 'border-[hsl(var(--border))] bg-[hsl(var(--card))]' : 'border-slate-200 bg-slate-50 opacity-75'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-black">{row.name}</h3>
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${row.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
                            {row.is_active ? 'ACTIVE' : 'ARCHIVED'}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                          {formatTime(row.start_time)}{row.end_time ? `–${formatTime(row.end_time)}` : ''} · {row.level} · {uniformLabel(row.uniform)}{row.mat ? ` · ${row.mat}` : ''}
                        </p>
                      </div>
                      {canManage ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => openEdit(row)}>
                          <Pencil className="h-4 w-4" /> Edit
                        </Button>
                      ) : null}
                    </div>

                    <div className="mt-3 grid gap-2 text-xs text-[hsl(var(--muted))] sm:grid-cols-2">
                      <div><span className="font-semibold text-black">Audience:</span> {audienceLabel(row.audience)}</div>
                      <div><span className="font-semibold text-black">Activity:</span> {activityLabel(row.activity_type)}</div>
                      <div><span className="font-semibold text-black">Ages:</span> {row.age_min == null ? 'Not restricted' : `${row.age_min}–${row.age_max}`}</div>
                      <div><span className="font-semibold text-black">Effective:</span> {formatDate(row.effective_from)} → {formatDate(row.effective_until)}</div>
                    </div>

                    {row.notes ? (
                      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                        <strong>Internal verification note:</strong> {row.notes}
                      </div>
                    ) : null}

                    {canManage ? (
                      <div className="mt-3 flex justify-end">
                        {row.is_active ? (
                          <Button type="button" variant="ghost" size="sm" onClick={() => setStatusTarget({ id: row.id, name: row.name, nextActive: false })}>
                            <Archive className="h-4 w-4" /> Archive
                          </Button>
                        ) : (
                          <Button type="button" variant="outline" size="sm" onClick={() => setStatusTarget({ id: row.id, name: row.name, nextActive: true })}>
                            <RotateCcw className="h-4 w-4" /> Restore
                          </Button>
                        )}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          )
        })}

        {!visibleTemplates.length ? (
          <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] p-6 text-center text-sm text-[hsl(var(--muted))]">
            No class templates to display.
          </div>
        ) : null}
      </div>

      <ConfirmActionModal
        open={Boolean(statusTarget)}
        title={statusTarget?.nextActive ? 'Restore class template?' : 'Archive class template?'}
        description={statusTarget?.nextActive ? 'The template becomes active again for future structured schedule use. No dated session is generated by Lot 2A.' : 'The template is kept for history but is removed from the active structured timetable. The current legacy member Schedule is unchanged.'}
        confirmLabel={statusTarget?.nextActive ? 'Restore' : 'Archive'}
        tone={statusTarget?.nextActive ? 'default' : 'destructive'}
        pending={pending}
        summaryItems={statusTarget ? [{ label: 'Class', value: statusTarget.name }] : []}
        onCancel={() => !pending && setStatusTarget(null)}
        onConfirm={applyStatus}
      />
    </div>
  )
}
