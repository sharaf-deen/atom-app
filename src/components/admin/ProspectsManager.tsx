'use client'

import { useMemo, useState } from 'react'
import ProspectConversionPanel from '@/components/admin/ProspectConversionPanel'
import ProspectMessageComposer, {
  ProspectTemplateAdmin,
  type MessageComposerRequest,
} from '@/components/admin/ProspectMessageComposer'
import ProspectMemberMatch, {
  ProspectMemberReconciliationSummary,
  matchesReconciliationFilter,
  type ReconciliationFilter,
} from '@/components/admin/ProspectMemberReconciliation'
import type {
  FrontDeskStaffRow,
  ProspectActivityRow,
  ProspectMemberReconciliationRow,
  ProspectMessageTemplateRow,
  ProspectMonthlyArchiveRow,
  ProspectRow,
  ProspectSubmissionRow,
} from '@/app/admin/prospects/page'
import {
  PROSPECT_LOST_REASONS,
  PROSPECT_STATUSES,
  normalizeProspectWhatsappDigits,
  type ProspectLostReason,
  type ProspectStatus,
} from '@/lib/prospects'

type Props = {
  currentUserId: string
  canManage: boolean
  canImport: boolean
  canEditTemplates: boolean
  prospects: ProspectRow[]
  submissions: ProspectSubmissionRow[]
  activities: ProspectActivityRow[]
  staff: FrontDeskStaffRow[]
  initialMessageTemplates: ProspectMessageTemplateRow[]
  monthlyArchive: ProspectMonthlyArchiveRow[]
  memberReconciliation: ProspectMemberReconciliationRow[]
}

type Draft = {
  status: ProspectStatus
  lost_reason: ProspectLostReason | ''
  assigned_to: string
  next_follow_up_at: string
}

type ImportSummary = {
  total_messages: number
  created_prospects: number
  inserted_submissions: number
  duplicate_messages: number
  skipped_invalid: number
  conflicts: number
}

type WorkQueueFilter =
  | 'all'
  | 'overdue'
  | 'today'
  | 'new_uncontacted'
  | 'mine'
  | 'unassigned'
  | 'upcoming_trials'

const WORK_QUEUE_LABELS: Record<WorkQueueFilter, string> = {
  all: 'All prospects',
  overdue: 'Overdue',
  today: 'Due today',
  new_uncontacted: 'New untouched',
  mine: 'Assigned to me',
  unassigned: 'Unassigned',
  upcoming_trials: 'Upcoming trials',
}

const CAIRO_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const CAIRO_MONTH_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
})

const STATUS_LABELS: Record<ProspectStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  awaiting_reply: 'Awaiting reply',
  trial_booked: 'Trial booked',
  trial_completed: 'Trial completed',
  joined: 'Joined',
  lost: 'Lost',
}

const LOST_REASON_LABELS: Record<ProspectLostReason, string> = {
  no_response: 'No response',
  not_interested: 'Not interested',
  invalid: 'Invalid contact',
  spam: 'Spam',
  other: 'Other',
}

function sourceLabel(source: ProspectSubmissionRow['source']) {
  if (source === 'contact_us') return 'Contact Us'
  if (source === 'visitor_information') return 'Visitor Information'
  return 'Website enquiry'
}

function sourceClass(source: ProspectSubmissionRow['source']) {
  if (source === 'contact_us') return 'border-sky-200 bg-sky-50 text-sky-800'
  if (source === 'visitor_information') return 'border-violet-200 bg-violet-50 text-violet-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function statusClass(status: ProspectStatus) {
  if (status === 'new') return 'border-amber-200 bg-amber-50 text-amber-900'
  if (status === 'contacted') return 'border-sky-200 bg-sky-50 text-sky-800'
  if (status === 'awaiting_reply') return 'border-indigo-200 bg-indigo-50 text-indigo-800'
  if (status === 'trial_booked') return 'border-violet-200 bg-violet-50 text-violet-800'
  if (status === 'trial_completed') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'joined') return 'border-green-200 bg-green-50 text-green-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function fmtDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function toInputDateTime(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function followUpIsDue(value?: string | null) {
  if (!value) return false
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) && ms <= Date.now()
}

function cairoDateKey(value: Date | string) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = CAIRO_DATE_FORMATTER.formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return year && month && day ? `${year}-${month}-${day}` : null
}

function cairoMonthKey(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = CAIRO_MONTH_FORMATTER.formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  return year && month ? `${year}-${month}` : null
}

function monthLabel(monthStart: string) {
  const date = new Date(`${monthStart}T12:00:00`)
  if (Number.isNaN(date.getTime())) return monthStart
  return new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'Africa/Cairo' }).format(date)
}

function followUpTiming(value: string | null | undefined, todayKey: string) {
  if (!value) return null
  const key = cairoDateKey(value)
  if (!key) return null
  if (key < todayKey) return 'overdue' as const
  if (key === todayKey) return 'today' as const
  return 'future' as const
}

function isActiveProspect(row: ProspectRow) {
  return !terminalStatus(row.status)
}

function isNewUncontacted(row: ProspectRow) {
  return row.status === 'new' && !row.last_contacted_at
}

function isUpcomingTrial(row: ProspectRow, todayKey: string) {
  return row.status === 'trial_booked'
    && Boolean(row.linked_visitor_trial_date)
    && String(row.linked_visitor_trial_date) >= todayKey
}

function matchesWorkQueue(
  row: ProspectRow,
  filter: WorkQueueFilter,
  currentUserId: string,
  todayKey: string,
) {
  if (filter === 'all') return true
  if (filter === 'overdue') return isActiveProspect(row) && followUpTiming(row.next_follow_up_at, todayKey) === 'overdue'
  if (filter === 'today') return isActiveProspect(row) && followUpTiming(row.next_follow_up_at, todayKey) === 'today'
  if (filter === 'new_uncontacted') return isActiveProspect(row) && isNewUncontacted(row)
  if (filter === 'mine') return isActiveProspect(row) && row.assigned_to === currentUserId
  if (filter === 'unassigned') return isActiveProspect(row) && !row.assigned_to
  return isActiveProspect(row) && isUpcomingTrial(row, todayKey)
}

function workQueueRank(row: ProspectRow, todayKey: string) {
  if (!isActiveProspect(row)) return 6
  const timing = followUpTiming(row.next_follow_up_at, todayKey)
  if (timing === 'overdue') return 0
  if (timing === 'today') return 1
  if (isNewUncontacted(row)) return 2
  if (isUpcomingTrial(row, todayKey)) return 3
  if (!row.assigned_to) return 4
  return 5
}

function compareWorkQueue(a: ProspectRow, b: ProspectRow, todayKey: string) {
  const rankA = workQueueRank(a, todayKey)
  const rankB = workQueueRank(b, todayKey)
  if (rankA !== rankB) return rankA - rankB

  if (rankA <= 1) {
    return new Date(a.next_follow_up_at ?? 0).getTime() - new Date(b.next_follow_up_at ?? 0).getTime()
  }
  if (rankA === 3) {
    return String(a.linked_visitor_trial_date ?? '').localeCompare(String(b.linked_visitor_trial_date ?? ''))
  }
  if (rankA === 4 || rankA === 5) {
    const nextA = a.next_follow_up_at ? new Date(a.next_follow_up_at).getTime() : Number.POSITIVE_INFINITY
    const nextB = b.next_follow_up_at ? new Date(b.next_follow_up_at).getTime() : Number.POSITIVE_INFINITY
    if (nextA !== nextB) return nextA - nextB
  }

  return new Date(b.last_submission_at).getTime() - new Date(a.last_submission_at).getTime()
}

function staffName(row?: FrontDeskStaffRow | null) {
  if (!row) return 'Unassigned'
  const full = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim()
  return full || row.email || row.role
}

function latestSubmission(rows: ProspectSubmissionRow[]) {
  return [...rows].sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime())[0] ?? null
}

function terminalStatus(status: ProspectStatus) {
  return status === 'joined' || status === 'lost'
}

function activityActorLabel(
  item: ProspectActivityRow,
  currentUserId: string,
  staffMap: Map<string, FrontDeskStaffRow>,
) {
  if (!item.actor_user_id) return ''
  if (item.actor_user_id === currentUserId) return 'You'
  const actor = staffMap.get(item.actor_user_id)
  return actor ? staffName(actor) : 'Staff'
}

function activityDetail(item: ProspectActivityRow, staffMap: Map<string, FrontDeskStaffRow>) {
  const details = item.details ?? {}

  if (item.activity_type === 'assignment') {
    const to = typeof details.to === 'string' ? details.to : ''
    const target = to ? staffMap.get(to) : null
    return to ? `Assigned to ${target ? staffName(target) : 'staff member'}` : 'Assignment cleared'
  }

  if (item.activity_type === 'follow_up_scheduled') {
    const to = typeof details.to === 'string' ? details.to : ''
    return to ? `Next follow-up: ${fmtDateTime(to)}` : 'Follow-up cleared'
  }

  if (item.activity_type === 'lost') {
    const reason = typeof details.lost_reason === 'string' ? details.lost_reason as ProspectLostReason : null
    return reason && PROSPECT_LOST_REASONS.includes(reason) ? `Reason: ${LOST_REASON_LABELS[reason]}` : ''
  }

  if (item.activity_type === 'status_change' && typeof details.to_lost_reason === 'string') {
    const reason = details.to_lost_reason as ProspectLostReason
    return PROSPECT_LOST_REASONS.includes(reason) ? `Reason: ${LOST_REASON_LABELS[reason]}` : ''
  }

  return ''
}

export default function ProspectsManager({
  currentUserId,
  canManage,
  canImport,
  canEditTemplates,
  prospects: initialProspects,
  submissions,
  activities: initialActivities,
  staff,
  initialMessageTemplates,
  monthlyArchive,
  memberReconciliation,
}: Props) {
  const [prospects, setProspects] = useState(initialProspects)
  const [activities, setActivities] = useState(initialActivities)
  const [messageTemplates, setMessageTemplates] = useState(initialMessageTemplates)
  const [composer, setComposer] = useState<MessageComposerRequest | null>(null)
  const [query, setQuery] = useState('')
  const [workQueueFilter, setWorkQueueFilter] = useState<WorkQueueFilter>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | ProspectStatus>('all')
  const [sourceFilter, setSourceFilter] = useState<'all' | ProspectSubmissionRow['source']>('all')
  const [assigneeFilter, setAssigneeFilter] = useState<'all' | 'unassigned' | string>('all')
  const [followUpOnly, setFollowUpOnly] = useState(false)
  const [monthFilter, setMonthFilter] = useState<'all' | string>('all')
  const [reconciliationFilter, setReconciliationFilter] = useState<ReconciliationFilter>('all')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      initialProspects.map((row) => [
        row.id,
        {
          status: row.status,
          lost_reason: row.lost_reason ?? '',
          assigned_to: row.assigned_to ?? '',
          next_follow_up_at: toInputDateTime(row.next_follow_up_at),
        },
      ]),
    ),
  )
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const todayKey = cairoDateKey(new Date()) ?? ''

  const submissionsByProspect = useMemo(() => {
    const map = new Map<string, ProspectSubmissionRow[]>()
    for (const row of submissions) {
      const current = map.get(row.prospect_id) ?? []
      current.push(row)
      map.set(row.prospect_id, current)
    }
    return map
  }, [submissions])

  const activitiesByProspect = useMemo(() => {
    const map = new Map<string, ProspectActivityRow[]>()
    for (const row of activities) {
      const current = map.get(row.prospect_id) ?? []
      current.push(row)
      map.set(row.prospect_id, current)
    }
    for (const rows of map.values()) {
      rows.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
    }
    return map
  }, [activities])

  const staffMap = useMemo(() => new Map(staff.map((row) => [row.user_id, row])), [staff])
  const reconciliationByProspect = useMemo(
    () => new Map(memberReconciliation.map((row) => [row.prospect_id, row])),
    [memberReconciliation],
  )

  const archiveByYear = useMemo(() => {
    const grouped = new Map<string, ProspectMonthlyArchiveRow[]>()
    for (const row of monthlyArchive) {
      const year = row.month_start.slice(0, 4)
      const current = grouped.get(year) ?? []
      current.push(row)
      grouped.set(year, current)
    }
    return Array.from(grouped.entries()).sort(([yearA], [yearB]) => yearB.localeCompare(yearA))
  }, [monthlyArchive])

  const queueCounts = useMemo(() => {
    return {
      all: prospects.length,
      overdue: prospects.filter((row) => matchesWorkQueue(row, 'overdue', currentUserId, todayKey)).length,
      today: prospects.filter((row) => matchesWorkQueue(row, 'today', currentUserId, todayKey)).length,
      new_uncontacted: prospects.filter((row) => matchesWorkQueue(row, 'new_uncontacted', currentUserId, todayKey)).length,
      mine: prospects.filter((row) => matchesWorkQueue(row, 'mine', currentUserId, todayKey)).length,
      unassigned: prospects.filter((row) => matchesWorkQueue(row, 'unassigned', currentUserId, todayKey)).length,
      upcoming_trials: prospects.filter((row) => matchesWorkQueue(row, 'upcoming_trials', currentUserId, todayKey)).length,
    }
  }, [prospects, currentUserId, todayKey])

  const pipelineCounts = useMemo(() => ({
    new: prospects.filter((row) => row.status === 'new').length,
    followUp: prospects.filter((row) => ['contacted', 'awaiting_reply', 'trial_completed'].includes(row.status)).length,
    trial: prospects.filter((row) => row.status === 'trial_booked').length,
    joined: prospects.filter((row) => row.status === 'joined').length,
    lost: prospects.filter((row) => row.status === 'lost').length,
  }), [prospects])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()

    return prospects.filter((row) => {
      const rows = submissionsByProspect.get(row.id) ?? []
      const sourceMatch = sourceFilter === 'all' || rows.some((item) => item.source === sourceFilter)
      if (!sourceMatch) return false
      if (monthFilter !== 'all' && !rows.some((item) => cairoMonthKey(item.received_at) === monthFilter)) return false
      if (!matchesReconciliationFilter(reconciliationByProspect.get(row.id), reconciliationFilter)) return false
      if (!matchesWorkQueue(row, workQueueFilter, currentUserId, todayKey)) return false
      if (statusFilter !== 'all' && row.status !== statusFilter) return false
      if (assigneeFilter === 'unassigned' && row.assigned_to) return false
      if (assigneeFilter !== 'all' && assigneeFilter !== 'unassigned' && row.assigned_to !== assigneeFilter) return false
      if (followUpOnly && (terminalStatus(row.status) || !followUpIsDue(row.next_follow_up_at))) return false

      if (!q) return true

      const haystack = [
        row.full_name,
        row.email ?? '',
        row.phone ?? '',
        ...rows.flatMap((item) => [
          item.submitted_name ?? '',
          item.submitted_email ?? '',
          item.submitted_phone ?? '',
          ...(item.requested_classes ?? []),
          item.submitted_level ?? '',
          ...(item.goals ?? []),
          item.message ?? '',
        ]),
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(q)
    }).sort((a, b) => compareWorkQueue(a, b, todayKey))
  }, [prospects, submissionsByProspect, reconciliationByProspect, query, workQueueFilter, statusFilter, sourceFilter, assigneeFilter, followUpOnly, monthFilter, reconciliationFilter, currentUserId, todayKey])

  function selectWorkQueue(filter: WorkQueueFilter) {
    setWorkQueueFilter(filter)
    setQuery('')
    setStatusFilter('all')
    setSourceFilter('all')
    setAssigneeFilter('all')
    setFollowUpOnly(false)
    setMonthFilter('all')
    setReconciliationFilter('all')
  }

  function clearFilters() {
    selectWorkQueue('all')
  }

  function selectArchiveMonth(month: string) {
    selectWorkQueue('all')
    setMonthFilter(month)
  }

  function selectReconciliation(filter: ReconciliationFilter) {
    selectWorkQueue('all')
    setReconciliationFilter(filter)
  }

  function mergeMessageTemplate(updated: ProspectMessageTemplateRow) {
    setMessageTemplates((rows) => rows.map((row) => row.id === updated.id ? updated : row))
  }

  function updateDraft(id: string, patch: Partial<Draft>) {
    setDrafts((current) => ({
      ...current,
      [id]: {
        ...(current[id] ?? {
          status: 'new',
          lost_reason: '',
          assigned_to: '',
          next_follow_up_at: '',
        }),
        ...patch,
      },
    }))
  }

  function mergeProspect(updated: ProspectRow) {
    setProspects((rows) => rows.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)))
    updateDraft(updated.id, {
      status: updated.status,
      lost_reason: updated.lost_reason ?? '',
      assigned_to: updated.assigned_to ?? '',
      next_follow_up_at: toInputDateTime(updated.next_follow_up_at),
    })
  }

  async function saveProspect(row: ProspectRow) {
    if (!canManage) return
    const draft = drafts[row.id]
    if (!draft) return

    if (draft.status === 'lost' && !draft.lost_reason) {
      setError('Select a lost reason before saving this prospect as Lost.')
      return
    }

    setBusyId(row.id)
    setError(null)
    setFlash(null)

    try {
      const followUpIso = terminalStatus(draft.status)
        ? null
        : draft.next_follow_up_at
          ? new Date(draft.next_follow_up_at).toISOString()
          : null
      const res = await fetch('/api/admin/prospects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospect_id: row.id,
          status: draft.status,
          lost_reason: draft.status === 'lost' ? draft.lost_reason : null,
          assigned_to: draft.assigned_to || null,
          next_follow_up_at: followUpIso,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Update failed.')

      mergeProspect(data.prospect as ProspectRow)
      setFlash(`${row.full_name} updated.`)
    } catch (e: any) {
      setError(String(e?.message ?? e ?? 'Update failed.'))
    } finally {
      setBusyId(null)
    }
  }

  async function addNote(row: ProspectRow) {
    if (!canManage) return
    const note = (notes[row.id] ?? '').trim()
    if (!note) return

    setBusyId(row.id)
    setError(null)
    setFlash(null)

    try {
      const res = await fetch('/api/admin/prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospect_id: row.id,
          action: 'note',
          note,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to add note.')

      setActivities((rows) => [data.activity as ProspectActivityRow, ...rows])
      setNotes((current) => ({ ...current, [row.id]: '' }))
      setFlash(`Note added for ${row.full_name}.`)
    } catch (e: any) {
      setError(String(e?.message ?? e ?? 'Failed to add note.'))
    } finally {
      setBusyId(null)
    }
  }

  async function recordContact(row: ProspectRow, channel: 'whatsapp' | 'call' | 'email') {
    if (!canManage) return false

    setBusyId(row.id)
    setError(null)
    setFlash(null)

    try {
      const res = await fetch('/api/admin/prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospect_id: row.id,
          action: 'log_contact',
          channel,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to log contact action.')

      if (data?.prospect) mergeProspect(data.prospect as ProspectRow)
      if (data?.activity) setActivities((rows) => [data.activity as ProspectActivityRow, ...rows])

      const label = channel === 'whatsapp' ? 'WhatsApp' : channel === 'call' ? 'Call' : 'Email'
      setFlash(`${label} contact initiated for ${row.full_name}.`)
      return true
    } catch (e: any) {
      setError(String(e?.message ?? e ?? 'Failed to log contact action.'))
      return false
    } finally {
      setBusyId(null)
    }
  }

  async function openCall(row: ProspectRow) {
    if (!row.phone || busyId === row.id) return
    const logged = await recordContact(row, 'call')
    if (logged) window.location.href = `tel:${row.phone}`
  }

  async function initiateComposedMessage(request: MessageComposerRequest, subject: string, message: string) {
    const { prospect, channel } = request
    if (busyId === prospect.id) return false

    const digits = channel === 'whatsapp' ? normalizeProspectWhatsappDigits(prospect.phone) : null
    if (channel === 'whatsapp' && !digits) return false
    if (channel === 'email' && !prospect.email) return false

    const popup = channel === 'whatsapp' ? window.open('', '_blank') : null
    const logged = await recordContact(prospect, channel)

    if (!logged) {
      popup?.close()
      return false
    }

    if (channel === 'whatsapp') {
      const url = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
      if (popup) {
        try {
          popup.opener = null
        } catch {}
        popup.location.href = url
      } else {
        window.location.href = url
      }
    } else {
      window.location.href = `mailto:${prospect.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`
    }

    setComposer(null)
    return true
  }

  async function importBackfill(file: File | null) {
    if (!canImport || !file) return

    setImportBusy(true)
    setImportSummary(null)
    setError(null)
    setFlash(null)

    try {
      const text = await file.text()
      const payload = JSON.parse(text)

      const res = await fetch('/api/admin/prospects/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Import failed.')

      setImportSummary(data.summary as ImportSummary)
      setFlash('Gmail backfill import completed. Refreshing the prospect list…')
      window.setTimeout(() => window.location.reload(), 1200)
    } catch (e: any) {
      setError(String(e?.message ?? e ?? 'Import failed.'))
    } finally {
      setImportBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      {flash ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {flash}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      <div className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Daily work queue</h2>
          <p className="text-sm text-[hsl(var(--muted))]">Select a queue to see who needs attention first.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-7">
          {(['all', 'overdue', 'today', 'new_uncontacted', 'mine', 'unassigned', 'upcoming_trials'] as WorkQueueFilter[]).map((filter) => (
            <QueueSummary
              key={filter}
              label={WORK_QUEUE_LABELS[filter]}
              value={queueCounts[filter]}
              active={workQueueFilter === filter}
              urgent={filter === 'overdue' && queueCounts.overdue > 0}
              onClick={() => selectWorkQueue(filter)}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[hsl(var(--muted))]">
          <span>New: <strong className="text-[hsl(var(--foreground))]">{pipelineCounts.new}</strong></span>
          <span>In follow-up: <strong className="text-[hsl(var(--foreground))]">{pipelineCounts.followUp}</strong></span>
          <span>Trial booked: <strong className="text-[hsl(var(--foreground))]">{pipelineCounts.trial}</strong></span>
          <span>Joined: <strong className="text-[hsl(var(--foreground))]">{pipelineCounts.joined}</strong></span>
          <span>Lost: <strong className="text-[hsl(var(--foreground))]">{pipelineCounts.lost}</strong></span>
        </div>
      </div>

      <ProspectMemberReconciliationSummary
        rows={memberReconciliation}
        activeFilter={reconciliationFilter}
        onSelect={selectReconciliation}
      />

      <details className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
        <summary className="cursor-pointer font-semibold">Submission archive by year and month</summary>
        <div className="mt-3 space-y-4">
          <p className="text-sm text-[hsl(var(--muted))]">
            Counts reflect stored CRM form submissions, including Gmail Backfill and Website Real-Time intake. They are not a Gmail inbox.
          </p>
          {archiveByYear.length ? archiveByYear.map(([year, months]) => (
            <div key={year} className="space-y-2">
              <h3 className="text-sm font-semibold">{year}</h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {months.map((month) => {
                  const key = month.month_start.slice(0, 7)
                  const active = monthFilter === key
                  return (
                    <button
                      key={month.month_start}
                      type="button"
                      aria-pressed={active}
                      onClick={() => active ? clearFilters() : selectArchiveMonth(key)}
                      className={`rounded-xl border p-3 text-left text-sm transition ${active ? 'border-black bg-black text-white' : 'border-[hsl(var(--border))] bg-slate-50 hover:border-slate-400'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <strong>{monthLabel(month.month_start)}</strong>
                        <span>{month.submissions_count} submissions</span>
                      </div>
                      <div className={`mt-1 text-xs ${active ? 'text-white/75' : 'text-[hsl(var(--muted))]'}`}>
                        {month.unique_prospects_count} prospects · Contact Us {month.contact_us_count} · Visitor {month.visitor_information_count}
                      </div>
                      <div className={`mt-1 text-xs ${active ? 'text-white/75' : 'text-[hsl(var(--muted))]'}`}>
                        Gmail Backfill {month.gmail_backfill_count} · Website Real-Time {month.website_api_count}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )) : (
            <div className="text-sm text-[hsl(var(--muted))]">No stored submissions yet.</div>
          )}
        </div>
      </details>

      <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Search</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, phone, email, class…"
              className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium">Status</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | ProspectStatus)}
              className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
            >
              <option value="all">All statuses</option>
              {PROSPECT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium">Source</span>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as typeof sourceFilter)}
              className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
            >
              <option value="all">All sources</option>
              <option value="contact_us">Contact Us</option>
              <option value="visitor_information">Visitor Information</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium">Assigned to</span>
            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
            >
              <option value="all">All staff</option>
              <option value="unassigned">Unassigned</option>
              {staff.map((row) => (
                <option key={row.user_id} value={row.user_id}>
                  {staffName(row)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-end gap-2 rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={followUpOnly}
              onChange={(e) => setFollowUpOnly(e.target.checked)}
            />
            <span className="pb-0.5">Follow-up due only</span>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[hsl(var(--muted))]">
          <span>
            Queue: <strong className="text-[hsl(var(--foreground))]">{WORK_QUEUE_LABELS[workQueueFilter]}</strong>
            {monthFilter !== 'all' ? <> · Archive: <strong className="text-[hsl(var(--foreground))]">{monthFilter}</strong></> : null}
            {reconciliationFilter !== 'all' ? <> · Member comparison: <strong className="text-[hsl(var(--foreground))]">{reconciliationFilter.replaceAll('_', ' ')}</strong></> : null}
            {' · '}Showing {filtered.length} of {prospects.length} prospects in priority order.
          </span>
          {(workQueueFilter !== 'all' || query || statusFilter !== 'all' || sourceFilter !== 'all' || assigneeFilter !== 'all' || followUpOnly || monthFilter !== 'all' || reconciliationFilter !== 'all') ? (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-lg border border-[hsl(var(--border))] px-2.5 py-1 font-semibold text-[hsl(var(--foreground))]"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      </div>

      {canEditTemplates ? (
        <ProspectTemplateAdmin templates={messageTemplates} onUpdated={mergeMessageTemplate} />
      ) : null}

      {canImport ? (
        <details className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
          <summary className="cursor-pointer font-semibold">Gmail historical backfill · Super Admin</summary>
          <div className="mt-3 space-y-3 text-sm">
            <p className="text-[hsl(var(--muted))]">
              Upload a private JSON export of ATOM website form emails. Existing Gmail message IDs are ignored,
              while matching email or phone reuses the same prospect record.
            </p>
            <input
              type="file"
              accept="application/json,.json"
              disabled={importBusy}
              onChange={(e) => void importBackfill(e.target.files?.[0] ?? null)}
              className="block w-full text-sm"
            />
            {importBusy ? <div>Importing…</div> : null}
            {importSummary ? (
              <div className="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-3">
                <div>Messages: <strong>{importSummary.total_messages}</strong></div>
                <div>New prospects: <strong>{importSummary.created_prospects}</strong></div>
                <div>Submissions: <strong>{importSummary.inserted_submissions}</strong></div>
                <div>Duplicates skipped: <strong>{importSummary.duplicate_messages}</strong></div>
                <div>Invalid skipped: <strong>{importSummary.skipped_invalid}</strong></div>
                <div>Conflicts: <strong>{importSummary.conflicts}</strong></div>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}

      <div className="space-y-3">
        {filtered.map((row) => {
          const rowSubmissions = submissionsByProspect.get(row.id) ?? []
          const rowActivities = activitiesByProspect.get(row.id) ?? []
          const latest = latestSubmission(rowSubmissions)
          const reconciliation = reconciliationByProspect.get(row.id) ?? null
          const draft = drafts[row.id]
          const isExpanded = !!expanded[row.id]
          const timing = isActiveProspect(row) ? followUpTiming(row.next_follow_up_at, todayKey) : null
          const newUncontacted = isActiveProspect(row) && isNewUncontacted(row)
          const upcomingTrial = isActiveProspect(row) && isUpcomingTrial(row, todayKey)

          return (
            <article
              key={row.id}
              className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">{row.full_name}</h2>
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClass(row.status)}`}>
                      {STATUS_LABELS[row.status]}
                    </span>
                    {latest ? (
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${sourceClass(latest.source)}`}>
                        {sourceLabel(latest.source)}
                      </span>
                    ) : null}
                    {timing === 'overdue' ? (
                      <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-800">
                        Overdue follow-up
                      </span>
                    ) : null}
                    {timing === 'today' ? (
                      <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-800">
                        Follow-up today
                      </span>
                    ) : null}
                    {newUncontacted ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">
                        Not contacted
                      </span>
                    ) : null}
                    {upcomingTrial ? (
                      <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-800">
                        Trial {row.linked_visitor_trial_date}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-[hsl(var(--muted))]">
                    {row.phone ? <span>{row.phone}</span> : null}
                    {row.email ? <span>{row.email}</span> : null}
                    <span>{rowSubmissions.length} submission{rowSubmissions.length === 1 ? '' : 's'}</span>
                    <span>Last enquiry: {fmtDateTime(row.last_submission_at)}</span>
                    {row.linked_visitor_trial_date ? <span>Trial date: {row.linked_visitor_trial_date}</span> : null}
                  </div>

                  {latest ? (
                    <div className="space-y-1 text-sm">
                      {latest.requested_classes?.length ? (
                        <div><strong>Classes:</strong> {latest.requested_classes.join(', ')}</div>
                      ) : null}
                      {latest.submitted_level ? (
                        <div><strong>Level:</strong> {latest.submitted_level}</div>
                      ) : null}
                      {latest.goals?.length ? (
                        <div><strong>Goals:</strong> {latest.goals.join(', ')}</div>
                      ) : null}
                      {latest.message ? (
                        <div><strong>Message:</strong> {latest.message}</div>
                      ) : null}
                    </div>
                  ) : null}

                  <ProspectMemberMatch
                    prospect={row}
                    reconciliation={reconciliation}
                    canManage={canManage}
                  />
                </div>

                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <button
                    type="button"
                    disabled={!row.phone || busyId === row.id}
                    onClick={() => setComposer({ prospect: row, latestSubmission: latest, channel: 'whatsapp' })}
                    className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm font-semibold text-green-800 disabled:opacity-40"
                  >
                    WhatsApp
                  </button>
                  <button
                    type="button"
                    disabled={!row.phone || busyId === row.id}
                    onClick={() => void openCall(row)}
                    className="rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-sm font-semibold disabled:opacity-40"
                  >
                    Call
                  </button>
                  <button
                    type="button"
                    disabled={!row.email || busyId === row.id}
                    onClick={() => setComposer({ prospect: row, latestSubmission: latest, channel: 'email' })}
                    className="rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-sm font-semibold disabled:opacity-40"
                  >
                    Email
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpanded((current) => ({ ...current, [row.id]: !current[row.id] }))}
                    className="rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-sm font-semibold"
                  >
                    {isExpanded ? 'Hide details' : 'Details'}
                  </button>
                </div>
              </div>

              {canManage && draft ? (
                <div className="mt-4 grid gap-3 rounded-2xl bg-slate-50 p-3 md:grid-cols-2 xl:grid-cols-4">
                  <label className="space-y-1 text-sm">
                    <span className="font-medium">Status</span>
                    <select
                      value={draft.status}
                      onChange={(e) => updateDraft(row.id, { status: e.target.value as ProspectStatus })}
                      className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
                    >
                      {PROSPECT_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  </label>

                  {draft.status === 'lost' ? (
                    <label className="space-y-1 text-sm">
                      <span className="font-medium">Lost reason</span>
                      <select
                        value={draft.lost_reason}
                        onChange={(e) => updateDraft(row.id, { lost_reason: e.target.value as ProspectLostReason })}
                        className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
                      >
                        <option value="">Select reason</option>
                        {PROSPECT_LOST_REASONS.map((reason) => (
                          <option key={reason} value={reason}>
                            {LOST_REASON_LABELS[reason]}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label className="space-y-1 text-sm">
                      <span className="font-medium">Assigned to</span>
                      <select
                        value={draft.assigned_to}
                        onChange={(e) => updateDraft(row.id, { assigned_to: e.target.value })}
                        className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2"
                      >
                        <option value="">Unassigned</option>
                        {staff.map((item) => (
                          <option key={item.user_id} value={item.user_id}>
                            {staffName(item)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label className="space-y-1 text-sm">
                    <span className="font-medium">Next follow-up</span>
                    <input
                      type="datetime-local"
                      value={terminalStatus(draft.status) ? '' : draft.next_follow_up_at}
                      disabled={terminalStatus(draft.status)}
                      onChange={(e) => updateDraft(row.id, { next_follow_up_at: e.target.value })}
                      className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    />
                    {terminalStatus(draft.status) ? (
                      <div className="text-xs text-[hsl(var(--muted))]">Cleared automatically for Joined/Lost.</div>
                    ) : null}
                  </label>

                  <div className="flex items-end">
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void saveProspect(row)}
                      className="w-full rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {busyId === row.id ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[hsl(var(--muted))]">
                <span>Assigned: {staffName(staffMap.get(row.assigned_to ?? ''))}</span>
                <span>Next follow-up: {fmtDateTime(row.next_follow_up_at)}</span>
                <span>Last contact: {fmtDateTime(row.last_contacted_at)}</span>
              </div>

              {isExpanded ? (
                <div className="mt-4 space-y-4">
                  {canManage ? (
                    <ProspectConversionPanel prospect={row} latestSubmission={latest} />
                  ) : null}
                  <div className="grid gap-4 xl:grid-cols-2">
                  <div className="space-y-3">
                    <h3 className="font-semibold">Submissions</h3>
                    {rowSubmissions.length ? (
                      rowSubmissions.map((item) => (
                        <div key={item.id} className="rounded-xl border border-[hsl(var(--border))] p-3 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${sourceClass(item.source)}`}>
                              {sourceLabel(item.source)}
                            </span>
                            <span className="text-xs text-[hsl(var(--muted))]">{fmtDateTime(item.received_at)}</span>
                          </div>
                          <div className="mt-2 space-y-1">
                            {item.requested_classes?.length ? <div>Classes: {item.requested_classes.join(', ')}</div> : null}
                            {item.submitted_level ? <div>Level: {item.submitted_level}</div> : null}
                            {item.goals?.length ? <div>Goals: {item.goals.join(', ')}</div> : null}
                            {item.message ? <div>Message: {item.message}</div> : null}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-[hsl(var(--muted))]">No submissions yet.</div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <h3 className="font-semibold">Activity</h3>

                    {canManage ? (
                      <div className="flex gap-2">
                        <textarea
                          value={notes[row.id] ?? ''}
                          onChange={(e) => setNotes((current) => ({ ...current, [row.id]: e.target.value }))}
                          placeholder="Add internal note…"
                          rows={2}
                          className="min-h-[72px] flex-1 rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm"
                        />
                        <button
                          type="button"
                          disabled={busyId === row.id || !(notes[row.id] ?? '').trim()}
                          onClick={() => void addNote(row)}
                          className="self-end rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          Add note
                        </button>
                      </div>
                    ) : null}

                    {rowActivities.length ? (
                      <div className="space-y-2">
                        {rowActivities.map((item) => (
                          <div key={item.id} className="rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-sm">
                            <div>{item.summary}</div>
                            {activityDetail(item, staffMap) ? (
                              <div className="mt-1 text-xs text-[hsl(var(--muted))]">{activityDetail(item, staffMap)}</div>
                            ) : null}
                            <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                              {fmtDateTime(item.occurred_at)}
                              {activityActorLabel(item, currentUserId, staffMap)
                                ? ` · ${activityActorLabel(item, currentUserId, staffMap)}`
                                : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-[hsl(var(--muted))]">No activity yet.</div>
                    )}
                  </div>
                  </div>
                </div>
              ) : null}
            </article>
          )
        })}

        {!filtered.length ? (
          <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] p-8 text-center text-sm text-[hsl(var(--muted))]">
            No prospects match the current filters.
          </div>
        ) : null}
      </div>

      <ProspectMessageComposer
        request={composer}
        templates={messageTemplates}
        busy={composer ? busyId === composer.prospect.id : false}
        onClose={() => setComposer(null)}
        onInitiate={initiateComposedMessage}
      />
    </div>
  )
}

function QueueSummary({
  label,
  value,
  active,
  urgent,
  onClick,
}: {
  label: string
  value: number
  active: boolean
  urgent: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-2xl border p-3 text-left shadow-soft transition ${
        active
          ? 'border-black bg-black text-white'
          : urgent
            ? 'border-rose-200 bg-rose-50 text-rose-900'
            : 'border-[hsl(var(--border))] bg-white hover:border-slate-400'
      }`}
    >
      <div className={`text-xs font-medium uppercase tracking-wide ${active ? 'text-white/70' : 'text-[hsl(var(--muted))]'}`}>
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </button>
  )
}
