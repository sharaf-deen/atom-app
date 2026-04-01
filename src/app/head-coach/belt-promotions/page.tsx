import type { ReactNode } from 'react'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PageHeader from '@/components/PageHeader'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import {
  BELT_PROMOTION_AUDIENCES,
  BELT_PROMOTION_DECISIONS,
  BELT_PROMOTION_EVENT_STATUSES,
  BELT_PROMOTION_PAYMENT_STATUSES,
  BELT_PROMOTION_PREPARATION_STATUSES,
  BELT_PROMOTION_TARGET_ROLES,
  buildSuggestedCandidate,
  decisionLabel,
  eventAudienceLabel,
  eventSummary,
  fullName,
  includesAudience,
  normalizeAudience,
  normalizeDecision,
  normalizeEventStatus,
  normalizePaymentStatus,
  normalizePreparationStatus,
  normalizeStripes,
  preparationTone,
  sanitizeCandidateNote,
  sanitizeEventNote,
  type BeltPromotionCandidateRow,
  type BeltPromotionEventRow,
  type BeltPromotionLogAction,
  type BeltPromotionLogRow,
  type BeltPromotionRosterRow,
} from '@/lib/beltPromotionEvents'
import { ageGroupFromDate, beltTrackForAgeGroup, fmtDate, titleCase } from '@/lib/headCoachAthletes'

export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>

type DashboardFilters = {
  event: string
  q: string
}

type CoachOption = {
  user_id: string
  first_name: string | null
  last_name: string | null
  role: string | null
}

function pick(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function buildHref(filters: Partial<DashboardFilters>) {
  const qs = new URLSearchParams()
  for (const [key, raw] of Object.entries(filters)) {
    if (raw === undefined || raw === null) continue
    const value = String(raw).trim()
    if (!value) continue
    qs.set(key, value)
  }
  const query = qs.toString()
  return query ? `/head-coach/belt-promotions?${query}` : '/head-coach/belt-promotions'
}

function toneClass(tone: 'neutral' | 'success' | 'warning' | 'danger') {
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (tone === 'danger') return 'border-rose-200 bg-rose-50 text-rose-700'
  return 'border-[hsl(var(--border))] bg-white text-[hsl(var(--muted))]'
}

function TinyBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClass(tone)}`}>{children}</span>
}

async function requireAccess(nextPath: string) {
  const me = await getSessionUserCached()
  if (!me || (me.role !== 'head_coach' && me.role !== 'super_admin')) redirect(nextPath)
  return me
}

async function writeLog(args: { eventId: string; action: BeltPromotionLogAction; candidateId?: string | null; details?: string | null }) {
  const admin = getSupabaseAdminClientCached()
  const insert = await admin.from('belt_promotion_event_logs').insert({
    id: crypto.randomUUID(),
    event_id: args.eventId,
    candidate_id: args.candidateId ?? null,
    action: args.action,
    details: args.details ?? null,
  })
  if (insert.error) throw new Error(insert.error.message)
}

async function createEventAction(formData: FormData) {
  'use server'

  await requireAccess('/head-coach/belt-promotions')
  const title = String(formData.get('title') || '').trim().slice(0, 120) || 'Belt Promotion Event'
  const eventDate = String(formData.get('event_date') || '').trim() || new Date().toISOString().slice(0, 10)
  const eventTime = String(formData.get('event_time') || '').trim() || null
  const audience = normalizeAudience(String(formData.get('audience') || 'mixed')) ?? 'mixed'
  const notes = sanitizeEventNote(formData.get('notes'))

  const admin = getSupabaseAdminClientCached()
  const eventId = crypto.randomUUID()
  const insert = await admin.from('belt_promotion_events').insert({
    id: eventId,
    title,
    event_date: eventDate,
    event_time: eventTime,
    audience,
    status: 'draft',
    notes,
  })
  if (insert.error) throw new Error(insert.error.message)

  await writeLog({ eventId, action: 'event_created', details: `${title} · ${eventDate}` })
  revalidatePath('/head-coach/belt-promotions')
  redirect(buildHref({ event: eventId }))
}

async function saveEventAction(formData: FormData) {
  'use server'

  const eventId = String(formData.get('eventId') || '').trim()
  if (!eventId) redirect('/head-coach/belt-promotions')
  await requireAccess(buildHref({ event: eventId }))

  const title = String(formData.get('title') || '').trim().slice(0, 120) || 'Belt Promotion Event'
  const eventDate = String(formData.get('event_date') || '').trim() || new Date().toISOString().slice(0, 10)
  const eventTime = String(formData.get('event_time') || '').trim() || null
  const audience = normalizeAudience(String(formData.get('audience') || 'mixed')) ?? 'mixed'
  const status = normalizeEventStatus(String(formData.get('status') || 'draft')) ?? 'draft'
  const notes = sanitizeEventNote(formData.get('notes'))

  const admin = getSupabaseAdminClientCached()
  const update = await admin
    .from('belt_promotion_events')
    .update({ title, event_date: eventDate, event_time: eventTime, audience, status, notes })
    .eq('id', eventId)
  if (update.error) throw new Error(update.error.message)

  await writeLog({ eventId, action: 'event_updated', details: `${title} · ${status}` })
  revalidatePath('/head-coach/belt-promotions')
  redirect(buildHref({ event: eventId }))
}

async function setEventStatusAction(formData: FormData) {
  'use server'

  const eventId = String(formData.get('eventId') || '').trim()
  const status = normalizeEventStatus(String(formData.get('status') || ''))
  if (!eventId || !status) redirect('/head-coach/belt-promotions')
  await requireAccess(buildHref({ event: eventId }))

  const admin = getSupabaseAdminClientCached()
  const update = await admin.from('belt_promotion_events').update({ status }).eq('id', eventId)
  if (update.error) throw new Error(update.error.message)

  await writeLog({ eventId, action: 'event_status_changed', details: status })
  revalidatePath('/head-coach/belt-promotions')
  redirect(buildHref({ event: eventId }))
}

async function addCandidateAction(formData: FormData) {
  'use server'

  const eventId = String(formData.get('eventId') || '').trim()
  const memberUserId = String(formData.get('member_user_id') || '').trim()
  if (!eventId || !memberUserId) redirect('/head-coach/belt-promotions')
  await requireAccess(buildHref({ event: eventId }))

  const currentBelt = String(formData.get('current_belt') || '').trim() || null
  const currentStripes = normalizeStripes(formData.get('current_stripes'))
  const proposedDecision = normalizeDecision(String(formData.get('proposed_decision') || 'none')) ?? 'none'
  const proposedBelt = String(formData.get('proposed_belt') || '').trim() || null
  const proposedStripesRaw = String(formData.get('proposed_stripes') || '').trim()
  const proposedStripes = proposedStripesRaw ? normalizeStripes(proposedStripesRaw) : null
  const preparationStatus = normalizePreparationStatus(String(formData.get('preparation_status') || 'suggested')) ?? 'suggested'
  const referenceCoachUserId = String(formData.get('reference_coach_user_id') || '').trim() || null
  const headCoachNote = sanitizeCandidateNote(formData.get('head_coach_note'))
  const athleteName = String(formData.get('athlete_name') || '').trim() || 'Athlete'

  const admin = getSupabaseAdminClientCached()
  const insert = await admin.from('belt_promotion_event_candidates').insert({
    id: crypto.randomUUID(),
    event_id: eventId,
    member_user_id: memberUserId,
    current_belt: currentBelt,
    current_stripes: currentStripes,
    proposed_decision: proposedDecision,
    proposed_belt: proposedBelt,
    proposed_stripes: proposedStripes,
    preparation_status: preparationStatus,
    final_decision: 'pending',
    attendance_status: 'pending',
    payment_status: 'pending',
    reference_coach_user_id: referenceCoachUserId,
    head_coach_note: headCoachNote,
    belt_delivered: false,
    certificate_delivered: false,
  })
  if (insert.error) throw new Error(insert.error.message)

  await writeLog({ eventId, action: 'candidate_added', details: athleteName })
  revalidatePath('/head-coach/belt-promotions')
  redirect(buildHref({ event: eventId }))
}

async function addSuggestedCandidatesAction(formData: FormData) {
  'use server'

  const eventId = String(formData.get('eventId') || '').trim()
  if (!eventId) redirect('/head-coach/belt-promotions')
  await requireAccess(buildHref({ event: eventId }))

  const admin = getSupabaseAdminClientCached()
  const [eventRes, existingRes, rosterRes] = await Promise.all([
    admin.from('belt_promotion_events').select('id, audience').eq('id', eventId).maybeSingle<{ id: string; audience: 'kids' | 'adults' | 'mixed' }>(),
    admin.from('belt_promotion_event_candidates').select('member_user_id').eq('event_id', eventId).returns<{ member_user_id: string }[]>(),
    admin.from('head_coach_athlete_roster').select('*').returns<BeltPromotionRosterRow[]>(),
  ])

  if (eventRes.error) throw new Error(eventRes.error.message)
  if (existingRes.error) throw new Error(existingRes.error.message)
  if (rosterRes.error) throw new Error(rosterRes.error.message)
  if (!eventRes.data) redirect('/head-coach/belt-promotions')

  const existingIds = new Set((existingRes.data ?? []).map((row) => row.member_user_id))
  const suggestions = (rosterRes.data ?? [])
    .filter((row) => !!row.role && BELT_PROMOTION_TARGET_ROLES.includes(row.role))
    .filter((row) => !existingIds.has(row.user_id))
    .map((row) => ({ row, suggestion: buildSuggestedCandidate(row) }))
    .filter(({ suggestion }) => includesAudience(eventRes.data!.audience, suggestion.age_group))
    .filter(({ suggestion }) => suggestion.priority_score >= 60 || suggestion.proposed_decision !== 'none')
    .sort((a, b) => b.suggestion.priority_score - a.suggestion.priority_score)
    .slice(0, 24)

  if (suggestions.length === 0) {
    revalidatePath('/head-coach/belt-promotions')
    redirect(buildHref({ event: eventId }))
  }

  const insert = await admin.from('belt_promotion_event_candidates').insert(
    suggestions.map(({ suggestion }, index) => ({
      id: crypto.randomUUID(),
      event_id: eventId,
      member_user_id: suggestion.member_user_id,
      current_belt: suggestion.current_belt,
      current_stripes: suggestion.current_stripes,
      proposed_decision: suggestion.proposed_decision,
      proposed_belt: suggestion.proposed_belt,
      proposed_stripes: suggestion.proposed_stripes,
      preparation_status: suggestion.preparation_status,
      final_decision: 'pending',
      attendance_status: 'pending',
      payment_status: 'pending',
      reference_coach_user_id: suggestion.reference_coach_user_id,
      head_coach_note: suggestion.head_coach_note,
      belt_delivered: false,
      certificate_delivered: false,
      sort_order: index + 1,
    })),
  )
  if (insert.error) throw new Error(insert.error.message)

  await writeLog({ eventId, action: 'suggestions_added', details: `${suggestions.length} suggestions added` })
  revalidatePath('/head-coach/belt-promotions')
  redirect(buildHref({ event: eventId }))
}

async function saveCandidateAction(formData: FormData) {
  'use server'

  const eventId = String(formData.get('eventId') || '').trim()
  const candidateId = String(formData.get('candidateId') || '').trim()
  if (!eventId || !candidateId) redirect('/head-coach/belt-promotions')
  await requireAccess(buildHref({ event: eventId }))

  const proposedDecision = normalizeDecision(String(formData.get('proposed_decision') || 'none')) ?? 'none'
  const proposedBelt = String(formData.get('proposed_belt') || '').trim() || null
  const proposedStripesRaw = String(formData.get('proposed_stripes') || '').trim()
  const proposedStripes = proposedDecision === 'stripe' ? normalizeStripes(proposedStripesRaw) : proposedDecision === 'belt' ? 0 : null
  const preparationStatus = normalizePreparationStatus(String(formData.get('preparation_status') || 'suggested')) ?? 'suggested'
  const paymentStatus = normalizePaymentStatus(String(formData.get('payment_status') || 'pending')) ?? 'pending'
  const headCoachNote = sanitizeCandidateNote(formData.get('head_coach_note'))
  const referenceCoachUserId = String(formData.get('reference_coach_user_id') || '').trim() || null

  const admin = getSupabaseAdminClientCached()
  const update = await admin
    .from('belt_promotion_event_candidates')
    .update({
      proposed_decision: proposedDecision,
      proposed_belt: proposedBelt,
      proposed_stripes: proposedStripes,
      preparation_status: preparationStatus,
      payment_status: paymentStatus,
      reference_coach_user_id: referenceCoachUserId,
      head_coach_note: headCoachNote,
    })
    .eq('id', candidateId)
    .eq('event_id', eventId)
  if (update.error) throw new Error(update.error.message)

  await writeLog({ eventId, candidateId, action: 'candidate_updated', details: `${preparationStatus} · ${proposedDecision}` })
  revalidatePath('/head-coach/belt-promotions')
  redirect(buildHref({ event: eventId }))
}

async function removeCandidateAction(formData: FormData) {
  'use server'

  const eventId = String(formData.get('eventId') || '').trim()
  const candidateId = String(formData.get('candidateId') || '').trim()
  if (!eventId || !candidateId) redirect('/head-coach/belt-promotions')
  await requireAccess(buildHref({ event: eventId }))

  const admin = getSupabaseAdminClientCached()
  const del = await admin.from('belt_promotion_event_candidates').delete().eq('id', candidateId).eq('event_id', eventId)
  if (del.error) throw new Error(del.error.message)

  await writeLog({ eventId, candidateId, action: 'candidate_removed', details: 'Candidate removed from event' })
  revalidatePath('/head-coach/belt-promotions')
  redirect(buildHref({ event: eventId }))
}

export default async function BeltPromotionEventsPage({ searchParams }: { searchParams?: SearchParams }) {
  const me = await getSessionUserCached()
  const signedInAs = me?.full_name || me?.email || null

  if (!me || (me.role !== 'head_coach' && me.role !== 'super_admin')) {
    return (
      <AccessDeniedPage
        title="Belt Promotion Events"
        subtitle="Access restricted."
        signedInAs={signedInAs}
        message="Only the head coach and super admin can manage belt promotion events."
        allowed="Allowed roles: Head Coach, Super Admin"
        nextPath="/head-coach/belt-promotions"
      />
    )
  }

  const filters: DashboardFilters = {
    event: pick(searchParams?.event) ?? '',
    q: pick(searchParams?.q) ?? '',
  }

  const admin = getSupabaseAdminClientCached()
  const [eventsRes, coachesRes] = await Promise.all([
    admin
      .from('belt_promotion_events')
      .select('id, title, event_date, event_time, audience, status, notes, created_at, updated_at')
      .order('event_date', { ascending: false })
      .order('created_at', { ascending: false })
      .returns<BeltPromotionEventRow[]>(),
    admin
      .from('profiles')
      .select('user_id, first_name, last_name, role')
      .in('role', ['assistant_coach', 'coach', 'head_coach'])
      .order('first_name', { ascending: true })
      .returns<CoachOption[]>(),
  ])

  if (eventsRes.error) throw new Error(eventsRes.error.message)
  if (coachesRes.error) throw new Error(coachesRes.error.message)

  const events = eventsRes.data ?? []
  const selectedEvent = events.find((row) => row.id === filters.event) ?? events[0] ?? null

  const [candidatesRes, logsRes, rosterRes] = selectedEvent
    ? await Promise.all([
        admin
          .from('belt_promotion_event_candidates')
          .select('*')
          .eq('event_id', selectedEvent.id)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true })
          .returns<BeltPromotionCandidateRow[]>(),
        admin
          .from('belt_promotion_event_logs')
          .select('id, event_id, candidate_id, action, details, created_at')
          .eq('event_id', selectedEvent.id)
          .order('created_at', { ascending: false })
          .limit(12)
          .returns<BeltPromotionLogRow[]>(),
        admin.from('head_coach_athlete_roster').select('*').returns<BeltPromotionRosterRow[]>(),
      ])
    : [
        { data: [], error: null as { message?: string } | null },
        { data: [], error: null as { message?: string } | null },
        { data: [], error: null as { message?: string } | null },
      ]

  if (candidatesRes.error) throw new Error(candidatesRes.error.message)
  if (logsRes.error) throw new Error(logsRes.error.message)
  if (rosterRes.error) throw new Error(rosterRes.error.message)

  const candidates = candidatesRes.data ?? []
  const summary = eventSummary(candidates)
  const existingCandidateIds = new Set(candidates.map((row) => row.member_user_id))
  const roster = (rosterRes.data ?? []).filter((row) => !!row.role && BELT_PROMOTION_TARGET_ROLES.includes(row.role))

  const suggestions = selectedEvent
    ? roster
        .filter((row) => !existingCandidateIds.has(row.user_id))
        .map(buildSuggestedCandidate)
        .filter((row) => includesAudience(selectedEvent.audience, row.age_group))
        .sort((a, b) => b.priority_score - a.priority_score || a.athlete_name.localeCompare(b.athlete_name))
    : []

  const q = filters.q.trim().toLowerCase()
  const manualResults = suggestions
    .filter((row) => !q || [row.athlete_name, row.member_id ?? '', row.reference_coach_name ?? ''].join(' ').toLowerCase().includes(q))
    .slice(0, 12)

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
      <PageHeader
        title="Belt Promotion Events"
        subtitle="Prepare the belt-promotion event before the day itself: create the event, build the candidate list, review suggested promotions, and track internal payment readiness."
        right={
          <div className="flex flex-wrap gap-2">
            <TinyBadge>{events.length} events</TinyBadge>
            {selectedEvent ? <TinyBadge tone="success">{summary.total} candidates</TinyBadge> : null}
          </div>
        }
      />

      <section className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
          <section className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Create new event</h2>
              <p className="mt-1 text-xs text-[hsl(var(--muted))]">Foundation lot: create the event shell first, then build the candidate list.</p>
            </div>
            <form action={createEventAction} className="mt-4 grid gap-3">
              <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Title</span><input type="text" name="title" defaultValue="Belt Promotion" className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Date</span><input type="date" name="event_date" defaultValue={new Date().toISOString().slice(0, 10)} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Time</span><input type="time" name="event_time" className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
              </div>
              <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Audience</span><select name="audience" defaultValue="mixed" className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black">{BELT_PROMOTION_AUDIENCES.map((option) => <option key={option} value={option}>{eventAudienceLabel(option)}</option>)}</select></label>
              <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Notes</span><textarea name="notes" rows={3} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
              <button type="submit" className="inline-flex items-center justify-center rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">Create event</button>
            </form>
          </section>

          <section className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold tracking-tight">Events</h2>
                <p className="mt-1 text-xs text-[hsl(var(--muted))]">Draft, published, live, and closed events.</p>
              </div>
              <TinyBadge>{events.length}</TinyBadge>
            </div>
            <div className="mt-4 grid gap-3">
              {events.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-8 text-center text-sm text-[hsl(var(--muted))]">No belt promotion event yet.</div>
              ) : events.map((event) => (
                <Link
                  key={event.id}
                  href={buildHref({ event: event.id })}
                  scroll={false}
                  className={`rounded-2xl border p-4 transition ${selectedEvent?.id === event.id ? 'border-black bg-[hsl(var(--bg))]' : 'border-[hsl(var(--border))] bg-white hover:bg-[hsl(var(--bg))]'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium leading-tight text-black">{event.title}</div>
                      <div className="mt-1 text-xs text-[hsl(var(--muted))]">{fmtDate(event.event_date)}{event.event_time ? ` · ${event.event_time}` : ''}</div>
                    </div>
                    <TinyBadge tone={event.status === 'live' ? 'success' : event.status === 'published' ? 'warning' : event.status === 'closed' ? 'neutral' : 'neutral'}>{titleCase(event.status)}</TinyBadge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
                    <span>{eventAudienceLabel(event.audience)}</span>
                    {event.notes ? <span>Notes ready</span> : <span>No notes yet</span>}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          {!selectedEvent ? (
            <section className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white px-4 py-12 text-center text-sm text-[hsl(var(--muted))] shadow-soft">
              Create the first belt promotion event to start preparing the candidate list.
            </section>
          ) : (
            <>
              <section className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight">{selectedEvent.title}</h2>
                    <p className="mt-1 text-sm text-[hsl(var(--muted))]">{fmtDate(selectedEvent.event_date)}{selectedEvent.event_time ? ` · ${selectedEvent.event_time}` : ''} · {eventAudienceLabel(selectedEvent.audience)} · {titleCase(selectedEvent.status)}</p>
                    {selectedEvent.notes ? <p className="mt-2 text-sm text-[hsl(var(--muted))]">{selectedEvent.notes}</p> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {BELT_PROMOTION_EVENT_STATUSES.map((status) => (
                      <form key={status} action={setEventStatusAction}>
                        <input type="hidden" name="eventId" value={selectedEvent.id} />
                        <input type="hidden" name="status" value={status} />
                        <button type="submit" className={`inline-flex items-center justify-center rounded-2xl border px-3 py-2 text-xs font-medium transition ${selectedEvent.status === status ? 'border-black bg-black text-white' : 'border-[hsl(var(--border))] bg-white text-black hover:bg-[hsl(var(--bg))]'}`}>
                          {titleCase(status)}
                        </button>
                      </form>
                    ))}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4"><div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Candidates</div><div className="mt-2 text-2xl font-semibold tracking-tight">{summary.total}</div></div>
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4"><div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Approved prep</div><div className="mt-2 text-2xl font-semibold tracking-tight">{summary.approved}</div></div>
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4"><div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Paid / pending</div><div className="mt-2 text-2xl font-semibold tracking-tight">{summary.paid} / {summary.pendingPayment}</div></div>
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4"><div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Belts / stripes</div><div className="mt-2 text-2xl font-semibold tracking-tight">{summary.belts} / {summary.stripes}</div></div>
                </div>
              </section>

              <section className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                <div>
                  <h3 className="text-sm font-semibold tracking-tight">Event setup</h3>
                  <p className="mt-1 text-xs text-[hsl(var(--muted))]">Still foundation-only: prepare the event and candidate list before live mode and final application.</p>
                </div>
                <form action={saveEventAction} className="mt-4 grid gap-3">
                  <input type="hidden" name="eventId" value={selectedEvent.id} />
                  <div className="grid gap-3 xl:grid-cols-2">
                    <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Title</span><input type="text" name="title" defaultValue={selectedEvent.title} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                    <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Status</span><select name="status" defaultValue={selectedEvent.status} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black">{BELT_PROMOTION_EVENT_STATUSES.map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}</select></label>
                    <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Date</span><input type="date" name="event_date" defaultValue={selectedEvent.event_date} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                    <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Time</span><input type="time" name="event_time" defaultValue={selectedEvent.event_time ?? ''} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                    <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Audience</span><select name="audience" defaultValue={selectedEvent.audience} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black">{BELT_PROMOTION_AUDIENCES.map((option) => <option key={option} value={option}>{eventAudienceLabel(option)}</option>)}</select></label>
                  </div>
                  <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Internal notes</span><textarea name="notes" rows={3} defaultValue={selectedEvent.notes ?? ''} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button type="submit" className="inline-flex items-center justify-center rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">Save event</button>
                  </div>
                </form>
              </section>

              <section className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
                <div className="space-y-4">
                  <section className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold tracking-tight">Suggested candidates</h3>
                        <p className="mt-1 text-xs text-[hsl(var(--muted))]">Uses current Head Coach progression signals to prefill the event list.</p>
                      </div>
                      <form action={addSuggestedCandidatesAction}>
                        <input type="hidden" name="eventId" value={selectedEvent.id} />
                        <button type="submit" className="inline-flex items-center justify-center rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">Add top suggestions</button>
                      </form>
                    </div>
                    <div className="mt-4 grid gap-3">
                      {suggestions.slice(0, 8).map((row) => (
                        <div key={row.member_user_id} className="rounded-2xl border border-[hsl(var(--border))] p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="font-medium leading-tight text-black">{row.athlete_name}</div>
                              <div className="mt-1 flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
                                {row.member_id ? <span>{row.member_id}</span> : null}
                                <span>{row.role ? titleCase(row.role) : 'Athlete'}</span>
                                <span>{titleCase(row.age_group)}</span>
                                {row.program_level ? <span>{titleCase(row.program_level)}</span> : null}
                              </div>
                            </div>
                            <TinyBadge tone={row.priority_score >= 100 ? 'success' : row.priority_score >= 70 ? 'warning' : 'neutral'}>Priority {row.priority_score}</TinyBadge>
                          </div>
                          <div className="mt-3 grid gap-2 text-sm text-[hsl(var(--muted))]">
                            <div><span className="font-medium text-black">Signal:</span> {row.promotion_label}</div>
                            <div><span className="font-medium text-black">Suggestion:</span> {decisionLabel(row.proposed_decision, row.proposed_belt, row.proposed_stripes)}</div>
                            <div><span className="font-medium text-black">Why:</span> {row.promotion_reason}</div>
                          </div>
                          <form action={addCandidateAction} className="mt-4">
                            <input type="hidden" name="eventId" value={selectedEvent.id} />
                            <input type="hidden" name="member_user_id" value={row.member_user_id} />
                            <input type="hidden" name="athlete_name" value={row.athlete_name} />
                            <input type="hidden" name="current_belt" value={row.current_belt ?? ''} />
                            <input type="hidden" name="current_stripes" value={row.current_stripes} />
                            <input type="hidden" name="proposed_decision" value={row.proposed_decision} />
                            <input type="hidden" name="proposed_belt" value={row.proposed_belt ?? ''} />
                            <input type="hidden" name="proposed_stripes" value={row.proposed_stripes ?? ''} />
                            <input type="hidden" name="preparation_status" value={row.preparation_status} />
                            <input type="hidden" name="reference_coach_user_id" value={row.reference_coach_user_id ?? ''} />
                            <input type="hidden" name="head_coach_note" value={row.head_coach_note ?? ''} />
                            <button type="submit" className="inline-flex items-center justify-center rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">Add to event</button>
                          </form>
                        </div>
                      ))}
                      {suggestions.length === 0 ? <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-8 text-center text-sm text-[hsl(var(--muted))]">No suggestion available for the current audience right now.</div> : null}
                    </div>
                  </section>

                  <section className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold tracking-tight">Manual add</h3>
                        <p className="mt-1 text-xs text-[hsl(var(--muted))]">Search the current Head Coach roster and add a candidate manually.</p>
                      </div>
                      <form className="w-full sm:w-auto">
                        <input type="hidden" name="event" value={selectedEvent.id} />
                        <input type="text" name="q" defaultValue={filters.q} placeholder="Search athlete / member ID / coach" className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black sm:w-72" />
                      </form>
                    </div>
                    <div className="mt-4 grid gap-3">
                      {manualResults.map((row) => (
                        <div key={row.member_user_id} className="rounded-2xl border border-[hsl(var(--border))] p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="font-medium leading-tight text-black">{row.athlete_name}</div>
                              <div className="mt-1 flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
                                {row.member_id ? <span>{row.member_id}</span> : null}
                                <span>{row.role ? titleCase(row.role) : 'Athlete'}</span>
                                <span>{row.reference_coach_name || 'No reference coach'}</span>
                              </div>
                            </div>
                            <TinyBadge tone={row.proposed_decision === 'belt' ? 'success' : row.proposed_decision === 'stripe' ? 'warning' : 'neutral'}>{decisionLabel(row.proposed_decision, row.proposed_belt, row.proposed_stripes)}</TinyBadge>
                          </div>
                          <form action={addCandidateAction} className="mt-4">
                            <input type="hidden" name="eventId" value={selectedEvent.id} />
                            <input type="hidden" name="member_user_id" value={row.member_user_id} />
                            <input type="hidden" name="athlete_name" value={row.athlete_name} />
                            <input type="hidden" name="current_belt" value={row.current_belt ?? ''} />
                            <input type="hidden" name="current_stripes" value={row.current_stripes} />
                            <input type="hidden" name="proposed_decision" value={row.proposed_decision} />
                            <input type="hidden" name="proposed_belt" value={row.proposed_belt ?? ''} />
                            <input type="hidden" name="proposed_stripes" value={row.proposed_stripes ?? ''} />
                            <input type="hidden" name="preparation_status" value={row.preparation_status} />
                            <input type="hidden" name="reference_coach_user_id" value={row.reference_coach_user_id ?? ''} />
                            <input type="hidden" name="head_coach_note" value={row.head_coach_note ?? ''} />
                            <button type="submit" className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-[hsl(var(--bg))]">Add manually</button>
                          </form>
                        </div>
                      ))}
                      {manualResults.length === 0 ? <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-8 text-center text-sm text-[hsl(var(--muted))]">No roster match for the current search.</div> : null}
                    </div>
                  </section>
                </div>

                <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
                  <section className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold tracking-tight">Candidates</h3>
                        <p className="mt-1 text-xs text-[hsl(var(--muted))]">Preparation status, internal payment tracking, and proposal review.</p>
                      </div>
                      <TinyBadge>{summary.total}</TinyBadge>
                    </div>
                    <div className="mt-4 grid gap-3">
                      {candidates.length === 0 ? <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-8 text-center text-sm text-[hsl(var(--muted))]">No candidate added yet.</div> : candidates.map((candidate) => {
                        const rosterRow = roster.find((row) => row.user_id === candidate.member_user_id)
                        const athleteName = rosterRow ? fullName(rosterRow.first_name, rosterRow.last_name, rosterRow.email) : candidate.member_user_id
                        const ageGroup = ageGroupFromDate(rosterRow?.date_of_birth)
                        const belts = beltTrackForAgeGroup(ageGroup)
                        return (
                          <form key={candidate.id} action={saveCandidateAction} className="grid gap-3 rounded-2xl border border-[hsl(var(--border))] p-4">
                            <input type="hidden" name="eventId" value={selectedEvent.id} />
                            <input type="hidden" name="candidateId" value={candidate.id} />
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="font-medium leading-tight text-black">{athleteName}</div>
                                <div className="mt-1 flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
                                  {rosterRow?.member_id ? <span>{rosterRow.member_id}</span> : null}
                                  {rosterRow?.role ? <span>{titleCase(rosterRow.role)}</span> : null}
                                  <span>{decisionLabel(candidate.proposed_decision, candidate.proposed_belt, candidate.proposed_stripes)}</span>
                                </div>
                              </div>
                              <TinyBadge tone={preparationTone(candidate.preparation_status)}>{titleCase(candidate.preparation_status)}</TinyBadge>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Preparation</span><select name="preparation_status" defaultValue={candidate.preparation_status} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black">{BELT_PROMOTION_PREPARATION_STATUSES.map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}</select></label>
                              <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Payment</span><select name="payment_status" defaultValue={candidate.payment_status} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black">{BELT_PROMOTION_PAYMENT_STATUSES.map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}</select></label>
                              <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Proposal</span><select name="proposed_decision" defaultValue={candidate.proposed_decision} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black">{BELT_PROMOTION_DECISIONS.map((decision) => <option key={decision} value={decision}>{titleCase(decision)}</option>)}</select></label>
                              <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Reference coach</span><select name="reference_coach_user_id" defaultValue={candidate.reference_coach_user_id ?? ''} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"><option value="">No reference coach</option>{(coachesRes.data ?? []).map((coach) => <option key={coach.user_id} value={coach.user_id}>{fullName(coach.first_name, coach.last_name, coach.role ? titleCase(coach.role) : 'Coach')}</option>)}</select></label>
                              <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Proposed belt</span><select name="proposed_belt" defaultValue={candidate.proposed_belt ?? ''} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"><option value="">No belt change</option>{belts.map((belt) => <option key={belt} value={belt}>{titleCase(belt)}</option>)}</select></label>
                              <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Proposed stripes</span><input type="number" min={0} max={4} name="proposed_stripes" defaultValue={candidate.proposed_stripes ?? ''} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                            </div>
                            <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Head coach note</span><textarea name="head_coach_note" rows={3} defaultValue={candidate.head_coach_note ?? ''} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                            <div className="flex flex-wrap justify-between gap-2">
                              <button type="submit" className="inline-flex items-center justify-center rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">Save candidate</button>
                              <button type="submit" formAction={removeCandidateAction} name="candidateId" value={candidate.id} className="inline-flex items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100">Remove</button>
                            </div>
                          </form>
                        )
                      })}
                    </div>
                  </section>

                  <section className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold tracking-tight">Recent event log</h3>
                        <p className="mt-1 text-xs text-[hsl(var(--muted))]">Creation, status changes, and candidate edits.</p>
                      </div>
                      <TinyBadge>{(logsRes.data ?? []).length}</TinyBadge>
                    </div>
                    <div className="mt-4 grid gap-3">
                      {(logsRes.data ?? []).length === 0 ? <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-8 text-center text-sm text-[hsl(var(--muted))]">No event activity yet.</div> : (logsRes.data ?? []).map((row) => (
                        <div key={row.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <TinyBadge>{titleCase(row.action)}</TinyBadge>
                            <TinyBadge>{fmtDate(row.created_at)}</TinyBadge>
                          </div>
                          {row.details ? <p className="mt-2 text-sm text-[hsl(var(--muted))]">{row.details}</p> : null}
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </section>
            </>
          )}
        </div>
      </section>
    </main>
  )
}
