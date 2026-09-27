import { Award, History, Layers3 } from 'lucide-react'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseRSC } from '@/lib/supabaseServer'
import type { Role } from '@/lib/session'

type ProgressEventType =
  | 'profile_update'
  | 'program_change'
  | 'stripe_award'
  | 'belt_promotion'
  | 'competition_result'
  | 'note'

type ProgressEventRow = {
  id: string
  member_user_id: string
  event_type: ProgressEventType
  effective_date: string
  previous_program_level: string | null
  next_program_level: string | null
  previous_belt_code: string | null
  next_belt_code: string | null
  previous_stripes: number | null
  next_stripes: number | null
  notes: string | null
  created_at: string | null
  created_by: string | null
}

type BeltRow = {
  id: string
  belt_code: string
  promoted_at: string
  notes: string | null
  created_at: string | null
}

type CorrectionRow = {
  progress_event_id: string
  reason: string
  corrected_at: string
  corrected_by: string | null
}

type TimelineKind = 'stripe' | 'belt' | 'program' | 'belt_record' | 'baseline'

type TimelineItem = {
  id: string
  kind: TimelineKind
  effectiveDate: string | null
  createdAt: string | null
  label: string
  detail: string | null
  note: string | null
  corrected: boolean
  correctionReason: string | null
  correctedAt: string | null
}

type Props = {
  memberUserId: string
  viewerRole: Role
  isSelf: boolean
  currentBelt: string | null
  currentStripes: number
}

function fmtDate(value?: string | null) {
  if (!value) return '—'
  const dt = new Date(value.length === 10 ? `${value}T00:00:00Z` : value)
  if (Number.isNaN(dt.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(dt)
}

function titleCase(value?: string | null) {
  if (!value) return '—'
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function normalizeStripes(value?: number | null) {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(4, Math.trunc(n)))
}

function stripeLabel(value?: number | null) {
  const stripes = normalizeStripes(value)
  return `${stripes} stripe${stripes === 1 ? '' : 's'}`
}

function rankLabel(belt?: string | null, stripes?: number | null) {
  const beltName = belt ? `${titleCase(belt)} belt` : 'White belt'
  return `${beltName} · ${stripeLabel(stripes)}`
}

function cleanNote(value?: string | null) {
  const note = String(value ?? '').trim()
  if (!note) return null
  const cleaned = note.replace(/^Promotion Desk · \d{4}-\d{2}-\d{2}\s*(?:—\s*)?/i, '').trim()
  return cleaned || null
}

function compareTimeline(a: TimelineItem, b: TimelineItem) {
  const dateCompare = String(b.effectiveDate ?? '').localeCompare(String(a.effectiveDate ?? ''))
  if (dateCompare !== 0) return dateCompare
  return String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))
}

function beltAtEvent(event: ProgressEventRow, beltRows: BeltRow[]) {
  const eventDate = event.effective_date
  const eventCreatedAt = event.created_at ?? ''

  const eligible = beltRows.filter((belt) => {
    if (belt.promoted_at < eventDate) return true
    if (belt.promoted_at > eventDate) return false

    const beltCreatedAt = belt.created_at ?? ''
    if (!beltCreatedAt || !eventCreatedAt) return false
    return beltCreatedAt <= eventCreatedAt
  })

  if (!eligible.length) return 'white'

  const sorted = eligible
    .slice()
    .sort((a, b) => {
      const dateCompare = a.promoted_at.localeCompare(b.promoted_at)
      if (dateCompare !== 0) return dateCompare
      return String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
    })

  return sorted[sorted.length - 1]?.belt_code ?? 'white'
}

function previousBeltForRecord(row: BeltRow, allBelts: BeltRow[]) {
  const previous = allBelts
    .filter((candidate) => {
      if (candidate.id === row.id) return false
      if (candidate.promoted_at < row.promoted_at) return true
      if (candidate.promoted_at > row.promoted_at) return false
      return String(candidate.created_at ?? '') < String(row.created_at ?? '')
    })
    .sort((a, b) => {
      const dateCompare = a.promoted_at.localeCompare(b.promoted_at)
      if (dateCompare !== 0) return dateCompare
      return String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
    })

  return previous[previous.length - 1]?.belt_code ?? 'white'
}

function itemTone(item: TimelineItem) {
  if (item.corrected) return 'border-amber-200 bg-amber-50/60'
  if (item.kind === 'belt' || item.kind === 'belt_record') return 'border-emerald-200 bg-emerald-50/40'
  if (item.kind === 'stripe') return 'border-violet-200 bg-violet-50/40'
  if (item.kind === 'program') return 'border-sky-200 bg-sky-50/40'
  return 'border-black/10 bg-black/[0.02]'
}

function kindLabel(kind: TimelineKind) {
  if (kind === 'belt' || kind === 'belt_record') return 'Belt'
  if (kind === 'stripe') return 'Stripe'
  if (kind === 'program') return 'Program'
  return 'Current baseline'
}

export default async function UnifiedProgressionHistory({
  memberUserId,
  viewerRole,
  isSelf,
  currentBelt,
  currentStripes,
}: Props) {
  const adminDb = createSupabaseAdminClient()
  const sessionDb = createSupabaseRSC()
  const db = isSelf ? sessionDb : adminDb
  const canViewInternalAudit = viewerRole === 'head_coach' || viewerRole === 'super_admin'

  const [progressRes, beltsRes] = await Promise.all([
    db
      .from('member_athlete_progress_events')
      .select(
        'id,member_user_id,event_type,effective_date,previous_program_level,next_program_level,previous_belt_code,next_belt_code,previous_stripes,next_stripes,notes,created_at,created_by',
      )
      .eq('member_user_id', memberUserId)
      .in('event_type', ['program_change', 'stripe_award', 'belt_promotion'])
      .order('effective_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(250)
      .returns<ProgressEventRow[]>(),
    db
      .from('member_belt_promotions')
      .select('id,belt_code,promoted_at,notes,created_at')
      .eq('member_user_id', memberUserId)
      .order('promoted_at', { ascending: false })
      .order('created_at', { ascending: false })
      .returns<BeltRow[]>(),
  ])

  const progressEvents = progressRes.data ?? []
  const beltRows = beltsRes.data ?? []
  const progressError = progressRes.error?.message ?? null

  const eventIds = progressEvents.map((event) => event.id)
  let corrections: CorrectionRow[] = []

  if (eventIds.length) {
    const correctionsRes = await adminDb
      .from('promotion_desk_corrections')
      .select('progress_event_id,reason,corrected_at,corrected_by')
      .in('progress_event_id', eventIds)
      .returns<CorrectionRow[]>()

    if (!correctionsRes.error) {
      corrections = correctionsRes.data ?? []
    }
  }

  const correctionByEvent = new Map(corrections.map((row) => [row.progress_event_id, row]))
  const recordedBeltKeys = new Set(
    progressEvents
      .filter((event) => event.event_type === 'belt_promotion' && event.next_belt_code)
      .map((event) => `${event.effective_date}|${String(event.next_belt_code).toLowerCase()}`),
  )

  const timeline: TimelineItem[] = []

  for (const event of progressEvents) {
    const correction = correctionByEvent.get(event.id)
    if (correction && !canViewInternalAudit) continue

    if (event.event_type === 'stripe_award') {
      const belt = beltAtEvent(event, beltRows)
      timeline.push({
        id: event.id,
        kind: 'stripe',
        effectiveDate: event.effective_date,
        createdAt: event.created_at,
        label: `${rankLabel(belt, event.previous_stripes)} → ${rankLabel(belt, event.next_stripes)}`,
        detail: 'Stripe promotion',
        note: cleanNote(event.notes),
        corrected: !!correction,
        correctionReason: correction?.reason ?? null,
        correctedAt: correction?.corrected_at ?? null,
      })
      continue
    }

    if (event.event_type === 'belt_promotion') {
      const previousBelt = event.previous_belt_code || 'white'
      const nextBelt = event.next_belt_code
      timeline.push({
        id: event.id,
        kind: 'belt',
        effectiveDate: event.effective_date,
        createdAt: event.created_at,
        label: `${rankLabel(previousBelt, event.previous_stripes)} → ${rankLabel(nextBelt, event.next_stripes)}`,
        detail: 'Belt promotion',
        note: cleanNote(event.notes),
        corrected: !!correction,
        correctionReason: correction?.reason ?? null,
        correctedAt: correction?.corrected_at ?? null,
      })
      continue
    }

    if (event.event_type === 'program_change') {
      timeline.push({
        id: event.id,
        kind: 'program',
        effectiveDate: event.effective_date,
        createdAt: event.created_at,
        label: `${titleCase(event.previous_program_level) || 'Not set'} → ${titleCase(event.next_program_level) || 'Not set'}`,
        detail: 'Program level change',
        note: cleanNote(event.notes),
        corrected: !!correction,
        correctionReason: correction?.reason ?? null,
        correctedAt: correction?.corrected_at ?? null,
      })
    }
  }

  // Older/manual belt records can predate progress events. Keep them visible without duplicating
  // belt promotions that already have a matching progression event.
  for (const belt of beltRows) {
    const key = `${belt.promoted_at}|${String(belt.belt_code).toLowerCase()}`
    if (recordedBeltKeys.has(key)) continue

    const previousBelt = previousBeltForRecord(belt, beltRows)
    timeline.push({
      id: `belt-record:${belt.id}`,
      kind: 'belt_record',
      effectiveDate: belt.promoted_at,
      createdAt: belt.created_at,
      label: `${titleCase(previousBelt)} belt → ${titleCase(belt.belt_code)} belt`,
      detail: 'Belt record',
      note: cleanNote(belt.notes),
      corrected: false,
      correctionReason: null,
      correctedAt: null,
    })
  }

  timeline.sort(compareTimeline)

  const activePromotionEvents = progressEvents.filter(
    (event) =>
      (event.event_type === 'stripe_award' || event.event_type === 'belt_promotion') &&
      !correctionByEvent.has(event.id),
  )
  const activeStripeCount = activePromotionEvents.filter((event) => event.event_type === 'stripe_award').length
  const activeBeltCount =
    activePromotionEvents.filter((event) => event.event_type === 'belt_promotion').length +
    beltRows.filter((belt) => !recordedBeltKeys.has(`${belt.promoted_at}|${String(belt.belt_code).toLowerCase()}`)).length

  const currentRank = currentBelt
    ? rankLabel(currentBelt, currentStripes)
    : currentStripes > 0
      ? rankLabel('white', currentStripes)
      : 'No rank recorded'

  return (
    <div className="mt-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <History size={17} />
            <h3 className="text-sm font-semibold tracking-tight">Progression history</h3>
          </div>
          <p className="mt-1 text-xs text-[hsl(var(--muted))]">
            Belt, stripe and program progression in one chronological timeline.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
            Current · {currentRank}
          </span>
          <span className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-white px-2.5 py-1 text-[11px] font-semibold text-[hsl(var(--muted))]">
            {activeStripeCount} stripe event{activeStripeCount === 1 ? '' : 's'}
          </span>
          <span className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-white px-2.5 py-1 text-[11px] font-semibold text-[hsl(var(--muted))]">
            {activeBeltCount} belt event{activeBeltCount === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {progressError ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Progression events could not be loaded. Existing belt records are still shown when available.
        </div>
      ) : null}

      {timeline.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--border))] bg-white">
              <Layers3 size={15} />
            </span>
            <div>
              <div className="text-sm font-medium">No recorded progression events yet.</div>
              <div className="mt-1 text-sm text-[hsl(var(--muted))]">
                {currentBelt || currentStripes > 0
                  ? `Current profile baseline: ${currentRank}. Future stripe and belt promotions will appear here automatically.`
                  : 'Future stripe and belt promotions will appear here automatically.'}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="relative mt-5">
          <div className="absolute bottom-3 left-[15px] top-3 w-px bg-black/10" aria-hidden="true" />

          <div className="grid gap-3">
            {timeline.map((item) => (
              <div key={item.id} className="relative pl-10">
                <span
                  className={
                    'absolute left-0 top-4 inline-flex h-[31px] w-[31px] items-center justify-center rounded-full border bg-white ' +
                    (item.corrected ? 'border-amber-300 text-amber-800' : 'border-black/10 text-black')
                  }
                >
                  <Award size={14} />
                </span>

                <div className={`rounded-2xl border p-4 ${itemTone(item)}`}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-black/10 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                          {kindLabel(item.kind)}
                        </span>
                        {item.corrected ? (
                          <span className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
                            Corrected
                          </span>
                        ) : null}
                      </div>

                      <div className={'mt-2 text-sm font-semibold sm:text-base ' + (item.corrected ? 'line-through opacity-60' : '')}>
                        {item.label}
                      </div>

                      {item.detail ? (
                        <div className="mt-1 text-xs text-[hsl(var(--muted))]">{item.detail}</div>
                      ) : null}

                      {item.note ? (
                        <div className="mt-2 text-sm text-[hsl(var(--muted))]">{item.note}</div>
                      ) : null}
                    </div>

                    <div className="shrink-0 text-xs font-medium text-[hsl(var(--muted))]">
                      {fmtDate(item.effectiveDate)}
                    </div>
                  </div>

                  {item.corrected && canViewInternalAudit ? (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-white/80 p-3 text-xs text-amber-950">
                      <div className="font-semibold">Correction: {item.correctionReason || 'Promotion reverted.'}</div>
                      {item.correctedAt ? (
                        <div className="mt-1">Corrected {fmtDate(item.correctedAt)}</div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
