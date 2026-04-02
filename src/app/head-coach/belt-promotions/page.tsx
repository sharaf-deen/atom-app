import type { ReactNode } from 'react'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PageHeader from '@/components/PageHeader'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import {
  BELT_PROMOTION_AUDIENCES,
  BELT_PROMOTION_ATTENDANCE_STATUSES,
  BELT_PROMOTION_DECISIONS,
  BELT_PROMOTION_EVENT_STATUSES,
  BELT_PROMOTION_FINAL_DECISIONS,
  BELT_PROMOTION_PAYMENT_STATUSES,
  BELT_PROMOTION_PREPARATION_STATUSES,
  BELT_PROMOTION_TARGET_ROLES,
  buildSuggestedCandidate,
  decisionLabel,
  eventAudienceLabel,
  eventSummary,
  finalDecisionTone,
  fullName,
  includesAudience,
  liveState,
  liveStateLabel,
  liveStateTone,
  normalizeAttendanceStatus,
  normalizeAudience,
  normalizeDecision,
  normalizeEventStatus,
  normalizeFinalDecision,
  normalizePaymentStatus,
  normalizePreparationStatus,
  normalizeStripes,
  paymentTone,
  preparationTone,
  sanitizeCandidateNote,
  sanitizeEventNote,
  sortCandidatesForLive,
  type BeltPromotionApplyRunRow,
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
  view: 'prep' | 'live'
}

type CoachOption = {
  user_id: string
  first_name: string | null
  last_name: string | null
  role: string | null
}

type EnrichedCandidate = BeltPromotionCandidateRow & {
  athlete_name: string
  member_id: string | null
  role: string | null
  program_level: string | null
  specialty: string | null
  reference_coach_name: string | null
  age_group: 'kids' | 'adults' | 'unknown'
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
  redirect(buildHref({ event: eventId, view: 'prep' }))
}

async function saveEventAction(formData: FormData) {
  'use server'
  const eventId = String(formData.get('eventId') || '').trim()
  const nextHref = String(formData.get('nextHref') || buildHref({ event: eventId, view: 'prep' }))
  if (!eventId) redirect('/head-coach/belt-promotions')
  await requireAccess(nextHref)

  const title = String(formData.get('title') || '').trim().slice(0, 120) || 'Belt Promotion Event'
  const eventDate = String(formData.get('event_date') || '').trim() || new Date().toISOString().slice(0, 10)
  const eventTime = String(formData.get('event_time') || '').trim() || null
  const audience = normalizeAudience(String(formData.get('audience') || 'mixed')) ?? 'mixed'
  const status = normalizeEventStatus(String(formData.get('status') || 'draft')) ?? 'draft'
  const notes = sanitizeEventNote(formData.get('notes'))

  const admin = getSupabaseAdminClientCached()
  const update = await admin.from('belt_promotion_events').update({ title, event_date: eventDate, event_time: eventTime, audience, status, notes }).eq('id', eventId)
  if (update.error) throw new Error(update.error.message)

  await writeLog({ eventId, action: 'event_updated', details: `${title} · ${status}` })
  revalidatePath('/head-coach/belt-promotions')
  redirect(nextHref)
}

async function setEventStatusAction(formData: FormData) {
  'use server'
  const eventId = String(formData.get('eventId') || '').trim()
  const status = normalizeEventStatus(String(formData.get('status') || ''))
  const nextHref = String(formData.get('nextHref') || buildHref({ event: eventId, view: 'prep' }))
  if (!eventId || !status) redirect('/head-coach/belt-promotions')
  await requireAccess(nextHref)

  const admin = getSupabaseAdminClientCached()
  const update = await admin.from('belt_promotion_events').update({ status }).eq('id', eventId)
  if (update.error) throw new Error(update.error.message)

  await writeLog({ eventId, action: 'event_status_changed', details: status })
  revalidatePath('/head-coach/belt-promotions')
  redirect(nextHref)
}

async function addSuggestedCandidatesAction(formData: FormData) {
  'use server'
  const eventId = String(formData.get('eventId') || '').trim()
  const nextHref = String(formData.get('nextHref') || buildHref({ event: eventId, view: 'prep' }))
  if (!eventId) redirect('/head-coach/belt-promotions')
  await requireAccess(nextHref)

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

  if (suggestions.length > 0) {
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
  }

  revalidatePath('/head-coach/belt-promotions')
  redirect(nextHref)
}

async function addCandidateAction(formData: FormData) {
  'use server'
  const eventId = String(formData.get('eventId') || '').trim()
  const nextHref = String(formData.get('nextHref') || buildHref({ event: eventId, view: 'prep' }))
  const memberUserId = String(formData.get('member_user_id') || '').trim()
  if (!eventId || !memberUserId) redirect('/head-coach/belt-promotions')
  await requireAccess(nextHref)

  const athleteName = String(formData.get('athlete_name') || '').trim() || 'Athlete'
  const currentBelt = String(formData.get('current_belt') || '').trim() || null
  const currentStripes = normalizeStripes(formData.get('current_stripes'))
  const proposedDecision = normalizeDecision(String(formData.get('proposed_decision') || 'none')) ?? 'none'
  const proposedBelt = String(formData.get('proposed_belt') || '').trim() || null
  const proposedStripesRaw = String(formData.get('proposed_stripes') || '').trim()
  const proposedStripes = proposedDecision === 'stripe' ? normalizeStripes(proposedStripesRaw) : proposedDecision === 'belt' ? 0 : null
  const preparationStatus = normalizePreparationStatus(String(formData.get('preparation_status') || 'suggested')) ?? 'suggested'
  const referenceCoachUserId = String(formData.get('reference_coach_user_id') || '').trim() || null
  const headCoachNote = sanitizeCandidateNote(formData.get('head_coach_note'))

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
  redirect(nextHref)
}

async function savePreparationCandidateAction(formData: FormData) {
  'use server'
  const eventId = String(formData.get('eventId') || '').trim()
  const candidateId = String(formData.get('candidateId') || '').trim()
  const nextHref = String(formData.get('nextHref') || buildHref({ event: eventId, view: 'prep' }))
  if (!eventId || !candidateId) redirect('/head-coach/belt-promotions')
  await requireAccess(nextHref)

  const proposedDecision = normalizeDecision(String(formData.get('proposed_decision') || 'none')) ?? 'none'
  const proposedBelt = String(formData.get('proposed_belt') || '').trim() || null
  const proposedStripesRaw = String(formData.get('proposed_stripes') || '').trim()
  const proposedStripes = proposedDecision === 'stripe' ? normalizeStripes(proposedStripesRaw) : proposedDecision === 'belt' ? 0 : null
  const preparationStatus = normalizePreparationStatus(String(formData.get('preparation_status') || 'suggested')) ?? 'suggested'
  const paymentStatus = normalizePaymentStatus(String(formData.get('payment_status') || 'pending')) ?? 'pending'
  const referenceCoachUserId = String(formData.get('reference_coach_user_id') || '').trim() || null
  const headCoachNote = sanitizeCandidateNote(formData.get('head_coach_note'))

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
  redirect(nextHref)
}

async function saveLiveCandidateAction(formData: FormData) {
  'use server'
  const eventId = String(formData.get('eventId') || '').trim()
  const candidateId = String(formData.get('candidateId') || '').trim()
  const nextHref = String(formData.get('nextHref') || buildHref({ event: eventId, view: 'live' }))
  if (!eventId || !candidateId) redirect('/head-coach/belt-promotions')
  await requireAccess(nextHref)

  const attendanceStatus = normalizeAttendanceStatus(String(formData.get('attendance_status') || 'pending')) ?? 'pending'
  const finalDecision = normalizeFinalDecision(String(formData.get('final_decision') || 'pending')) ?? 'pending'
  const paymentStatus = normalizePaymentStatus(String(formData.get('payment_status') || 'pending')) ?? 'pending'
  const beltDelivered = String(formData.get('belt_delivered') || '') === 'on'
  const certificateDelivered = String(formData.get('certificate_delivered') || '') === 'on'
  const headCoachNote = sanitizeCandidateNote(formData.get('head_coach_note'))

  const admin = getSupabaseAdminClientCached()
  const update = await admin
    .from('belt_promotion_event_candidates')
    .update({
      attendance_status: attendanceStatus,
      final_decision: finalDecision,
      payment_status: paymentStatus,
      belt_delivered: beltDelivered,
      certificate_delivered: certificateDelivered,
      head_coach_note: headCoachNote,
    })
    .eq('id', candidateId)
    .eq('event_id', eventId)
  if (update.error) throw new Error(update.error.message)

  await writeLog({ eventId, candidateId, action: 'candidate_updated', details: `live · ${attendanceStatus} · ${finalDecision}` })
  revalidatePath('/head-coach/belt-promotions')
  redirect(nextHref)
}

async function quickLiveAction(formData: FormData) {
  'use server'
  const eventId = String(formData.get('eventId') || '').trim()
  const candidateId = String(formData.get('candidateId') || '').trim()
  const nextHref = String(formData.get('nextHref') || buildHref({ event: eventId, view: 'live' }))
  const kind = String(formData.get('kind') || '').trim()
  if (!eventId || !candidateId || !kind) redirect('/head-coach/belt-promotions')
  await requireAccess(nextHref)

  const patch: Record<string, unknown> = {}
  if (kind === 'present') patch.attendance_status = 'present'
  else if (kind === 'absent') {
    patch.attendance_status = 'absent'
    patch.final_decision = 'absent'
  } else if (kind === 'confirm') {
    patch.attendance_status = 'present'
    patch.final_decision = 'confirmed'
  } else if (kind === 'defer') {
    patch.attendance_status = 'present'
    patch.final_decision = 'deferred'
  } else if (kind === 'paid') patch.payment_status = 'paid'
  else if (kind === 'waived') patch.payment_status = 'waived'
  else if (kind === 'belt_delivered') patch.belt_delivered = true
  else if (kind === 'certificate_delivered') patch.certificate_delivered = true

  const admin = getSupabaseAdminClientCached()
  const update = await admin.from('belt_promotion_event_candidates').update(patch).eq('id', candidateId).eq('event_id', eventId)
  if (update.error) throw new Error(update.error.message)

  await writeLog({ eventId, candidateId, action: 'candidate_updated', details: `quick:${kind}` })
  revalidatePath('/head-coach/belt-promotions')
  redirect(nextHref)
}

async function removeCandidateAction(formData: FormData) {
  'use server'
  const eventId = String(formData.get('eventId') || '').trim()
  const candidateId = String(formData.get('candidateId') || '').trim()
  const nextHref = String(formData.get('nextHref') || buildHref({ event: eventId, view: 'prep' }))
  if (!eventId || !candidateId) redirect('/head-coach/belt-promotions')
  await requireAccess(nextHref)

  const admin = getSupabaseAdminClientCached()
  const del = await admin.from('belt_promotion_event_candidates').delete().eq('id', candidateId).eq('event_id', eventId)
  if (del.error) throw new Error(del.error.message)

  await writeLog({ eventId, candidateId, action: 'candidate_removed', details: 'Candidate removed from event' })
  revalidatePath('/head-coach/belt-promotions')
  redirect(nextHref)
}

async function applyConfirmedResultsAction(formData: FormData) {
  'use server'
  const eventId = String(formData.get('eventId') || '').trim()
  const nextHref = String(formData.get('nextHref') || buildHref({ event: eventId, view: 'live' }))
  const confirmApply = String(formData.get('confirm_apply') || '').trim() === 'yes'
  const closeEventAfter = String(formData.get('close_event_after') || '').trim() === 'on'
  if (!eventId || !confirmApply) redirect(nextHref)

  const me = await requireAccess(nextHref)
  const admin = getSupabaseAdminClientCached()
  const [eventRes, candidatesRes] = await Promise.all([
    admin
      .from('belt_promotion_events')
      .select('id, title, event_date, status')
      .eq('id', eventId)
      .maybeSingle<{ id: string; title: string; event_date: string; status: string }>(),
    admin
      .from('belt_promotion_event_candidates')
      .select('*')
      .eq('event_id', eventId)
      .eq('final_decision', 'confirmed')
      .is('results_applied_at', null)
      .returns<BeltPromotionCandidateRow[]>(),
  ])

  if (eventRes.error) throw new Error(eventRes.error.message)
  if (candidatesRes.error) throw new Error(candidatesRes.error.message)
  if (!eventRes.data) redirect('/head-coach/belt-promotions')

  const candidates = candidatesRes.data ?? []
  if (candidates.length === 0) redirect(nextHref)

  const runId = crypto.randomUUID()
  let stripeCount = 0
  let beltCount = 0
  let noteCount = 0

  for (const candidate of candidates) {
    const trainingRes = await admin
      .from('member_training_profiles')
      .select('program_level, stripes, specialty, reference_coach_user_id, notes')
      .eq('member_user_id', candidate.member_user_id)
      .maybeSingle<{ program_level: string | null; stripes: number | null; specialty: string | null; reference_coach_user_id: string | null; notes: string | null }>()
    if (trainingRes.error) throw new Error(trainingRes.error.message)

    const training = trainingRes.data
    const eventNote = `${eventRes.data.title} · ${eventRes.data.event_date}`

    if (candidate.proposed_decision === 'stripe') {
      const nextStripes = normalizeStripes(candidate.proposed_stripes ?? candidate.current_stripes ?? 0)
      const upsert = await admin.from('member_training_profiles').upsert(
        {
          member_user_id: candidate.member_user_id,
          program_level: training?.program_level ?? null,
          stripes: nextStripes,
          specialty: training?.specialty ?? null,
          reference_coach_user_id: candidate.reference_coach_user_id ?? training?.reference_coach_user_id ?? null,
          notes: training?.notes ?? candidate.head_coach_note ?? null,
          updated_by: me.id,
        },
        { onConflict: 'member_user_id' },
      )
      if (upsert.error) throw new Error(upsert.error.message)

      const progress = await admin.from('member_athlete_progress_events').insert({
        id: crypto.randomUUID(),
        member_user_id: candidate.member_user_id,
        event_type: 'stripe_award',
        effective_date: eventRes.data.event_date,
        previous_program_level: training?.program_level ?? null,
        next_program_level: training?.program_level ?? null,
        previous_stripes: training?.stripes ?? candidate.current_stripes ?? 0,
        next_stripes: nextStripes,
        notes: `${eventNote}${candidate.head_coach_note ? ` — ${candidate.head_coach_note}` : ''}`,
        created_by: me.id,
      })
      if (progress.error) throw new Error(progress.error.message)
      stripeCount += 1
    } else if (candidate.proposed_decision === 'belt' && candidate.proposed_belt) {
      const insertBelt = await admin.from('member_belt_promotions').insert({
        id: crypto.randomUUID(),
        member_user_id: candidate.member_user_id,
        belt_code: candidate.proposed_belt,
        promoted_at: eventRes.data.event_date,
        notes: `${eventNote}${candidate.head_coach_note ? ` — ${candidate.head_coach_note}` : ''}`,
        created_by: me.id,
        updated_by: me.id,
      })
      if (insertBelt.error) throw new Error(insertBelt.error.message)

      const upsert = await admin.from('member_training_profiles').upsert(
        {
          member_user_id: candidate.member_user_id,
          program_level: training?.program_level ?? null,
          stripes: 0,
          specialty: training?.specialty ?? null,
          reference_coach_user_id: candidate.reference_coach_user_id ?? training?.reference_coach_user_id ?? null,
          notes: training?.notes ?? candidate.head_coach_note ?? null,
          updated_by: me.id,
        },
        { onConflict: 'member_user_id' },
      )
      if (upsert.error) throw new Error(upsert.error.message)

      const progress = await admin.from('member_athlete_progress_events').insert({
        id: crypto.randomUUID(),
        member_user_id: candidate.member_user_id,
        event_type: 'belt_promotion',
        effective_date: eventRes.data.event_date,
        previous_program_level: training?.program_level ?? null,
        next_program_level: training?.program_level ?? null,
        previous_belt_code: candidate.current_belt ?? null,
        next_belt_code: candidate.proposed_belt,
        previous_stripes: training?.stripes ?? candidate.current_stripes ?? 0,
        next_stripes: 0,
        notes: `${eventNote}${candidate.head_coach_note ? ` — ${candidate.head_coach_note}` : ''}`,
        created_by: me.id,
      })
      if (progress.error) throw new Error(progress.error.message)
      beltCount += 1
    } else {
      const noteInsert = await admin.from('member_athlete_progress_events').insert({
        id: crypto.randomUUID(),
        member_user_id: candidate.member_user_id,
        event_type: 'note',
        effective_date: eventRes.data.event_date,
        notes: `${eventNote} — confirmed with no promotion${candidate.head_coach_note ? ` — ${candidate.head_coach_note}` : ''}`,
        created_by: me.id,
      })
      if (noteInsert.error) throw new Error(noteInsert.error.message)
      noteCount += 1
    }

    const markApplied = await admin
      .from('belt_promotion_event_candidates')
      .update({ results_applied_at: new Date().toISOString(), results_applied_by: me.id })
      .eq('id', candidate.id)
      .eq('event_id', eventId)
    if (markApplied.error) throw new Error(markApplied.error.message)
  }

  const applyRun = await admin.from('belt_promotion_event_apply_runs').insert({
    id: runId,
    event_id: eventId,
    applied_count: candidates.length,
    stripe_count: stripeCount,
    belt_count: beltCount,
    note_count: noteCount,
    closed_event: closeEventAfter,
    applied_by: me.id,
    notes: `${eventRes.data.title} apply run`,
  })
  if (applyRun.error) throw new Error(applyRun.error.message)

  if (closeEventAfter) {
    const closeRes = await admin.from('belt_promotion_events').update({ status: 'closed' }).eq('id', eventId)
    if (closeRes.error) throw new Error(closeRes.error.message)
  }

  await writeLog({ eventId, action: 'results_applied', details: `${candidates.length} confirmed results applied` })
  revalidatePath('/head-coach/belt-promotions')
  revalidatePath('/head-coach/athletes')
  revalidatePath('/members/[id]')
  redirect(nextHref)
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
    view: pick(searchParams?.view) === 'live' ? 'live' : 'prep',
  }

  const admin = getSupabaseAdminClientCached()
  const [eventsRes, coachesRes, rosterRes] = await Promise.all([
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
    admin.from('head_coach_athlete_roster').select('*').returns<BeltPromotionRosterRow[]>(),
  ])

  if (eventsRes.error) throw new Error(eventsRes.error.message)
  if (coachesRes.error) throw new Error(coachesRes.error.message)
  if (rosterRes.error) throw new Error(rosterRes.error.message)

  const events = eventsRes.data ?? []
  const selectedEvent = events.find((row) => row.id === filters.event) ?? events[0] ?? null
  const roster = (rosterRes.data ?? []).filter((row) => !!row.role && BELT_PROMOTION_TARGET_ROLES.includes(row.role))

  let candidates: BeltPromotionCandidateRow[] = []
  let logs: BeltPromotionLogRow[] = []
  let applyRuns: BeltPromotionApplyRunRow[] = []
  if (selectedEvent) {
    const [candidatesRes, logsRes, applyRunsRes] = await Promise.all([
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
        .limit(16)
        .returns<BeltPromotionLogRow[]>(),
      admin
        .from('belt_promotion_event_apply_runs')
        .select('id, event_id, applied_count, stripe_count, belt_count, note_count, closed_event, created_at, applied_by, notes')
        .eq('event_id', selectedEvent.id)
        .order('created_at', { ascending: false })
        .limit(8)
        .returns<BeltPromotionApplyRunRow[]>(),
    ])
    if (candidatesRes.error) throw new Error(candidatesRes.error.message)
    if (logsRes.error) throw new Error(logsRes.error.message)
    if (applyRunsRes.error) throw new Error(applyRunsRes.error.message)
    candidates = candidatesRes.data ?? []
    logs = logsRes.data ?? []
    applyRuns = applyRunsRes.data ?? []
  }

  const rosterMap = new Map(roster.map((row) => [row.user_id, row]))
  const enrichedCandidates: EnrichedCandidate[] = candidates.map((row) => {
    const rosterRow = rosterMap.get(row.member_user_id)
    return {
      ...row,
      athlete_name: fullName(rosterRow?.first_name, rosterRow?.last_name, rosterRow?.email),
      member_id: rosterRow?.member_id ?? null,
      role: rosterRow?.role ?? null,
      program_level: rosterRow?.program_level ?? null,
      specialty: rosterRow?.specialty ?? null,
      reference_coach_name: rosterRow?.reference_coach_name ?? null,
      age_group: rosterRow ? ageGroupFromDate(rosterRow.date_of_birth) : 'unknown',
    }
  })

  const summary = eventSummary(candidates)
  const latestApplyRun = applyRuns[0] ?? null
  const existingCandidateIds = new Set(candidates.map((row) => row.member_user_id))
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
  const filteredCandidates = enrichedCandidates.filter((row) => !q || [row.athlete_name, row.member_id ?? '', row.reference_coach_name ?? '', row.program_level ?? ''].join(' ').toLowerCase().includes(q))
  const liveCandidates = sortCandidatesForLive(filteredCandidates)
  const nextPrepHref = buildHref({ event: selectedEvent?.id ?? '', view: 'prep', q: filters.q })
  const nextLiveHref = buildHref({ event: selectedEvent?.id ?? '', view: 'live', q: filters.q })

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
      <PageHeader
        title="Belt Promotion Events"
        subtitle="Before: prepare the event and candidate list. During: switch to live mode to manage attendance, decisions, and belt/certificate delivery with fast terrain-friendly actions."
        right={
          <div className="flex flex-wrap gap-2">
            <TinyBadge>{events.length} events</TinyBadge>
            {selectedEvent ? <TinyBadge tone="success">{summary.total} candidates</TinyBadge> : null}
            {selectedEvent && filters.view === 'live' ? <TinyBadge tone="warning">Live mode</TinyBadge> : null}
          </div>
        }
      />

      <section className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
          <section className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Create new event</h2>
              <p className="mt-1 text-xs text-[hsl(var(--muted))]">Create the shell first, then prepare candidates or switch to live mode on the event day.</p>
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
                <p className="mt-1 text-xs text-[hsl(var(--muted))]">Open an existing event to prepare it or run it live.</p>
              </div>
              <TinyBadge>{events.length}</TinyBadge>
            </div>
            <div className="mt-4 grid gap-3">
              {events.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-8 text-center text-sm text-[hsl(var(--muted))]">No belt promotion event yet.</div>
              ) : events.map((event) => (
                <Link
                  key={event.id}
                  href={buildHref({ event: event.id, view: filters.view })}
                  scroll={false}
                  className={`rounded-2xl border p-4 transition ${selectedEvent?.id === event.id ? 'border-black bg-[hsl(var(--bg))]' : 'border-[hsl(var(--border))] bg-white hover:bg-[hsl(var(--bg))]'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium leading-tight text-black">{event.title}</div>
                      <div className="mt-1 text-xs text-[hsl(var(--muted))]">{fmtDate(event.event_date)}{event.event_time ? ` · ${event.event_time}` : ''}</div>
                    </div>
                    <TinyBadge tone={event.status === 'live' ? 'success' : event.status === 'published' ? 'warning' : 'neutral'}>{titleCase(event.status)}</TinyBadge>
                  </div>
                  <div className="mt-3 text-xs text-[hsl(var(--muted))]">{eventAudienceLabel(event.audience)}</div>
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
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight">{selectedEvent.title}</h2>
                    <p className="mt-1 text-sm text-[hsl(var(--muted))]">{fmtDate(selectedEvent.event_date)}{selectedEvent.event_time ? ` · ${selectedEvent.event_time}` : ''} · {eventAudienceLabel(selectedEvent.audience)} · {titleCase(selectedEvent.status)}</p>
                    {selectedEvent.notes ? <p className="mt-2 text-sm text-[hsl(var(--muted))]">{selectedEvent.notes}</p> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link href={nextPrepHref} scroll={false} className={`inline-flex items-center justify-center rounded-2xl border px-4 py-2 text-sm font-medium transition ${filters.view === 'prep' ? 'border-black bg-black text-white' : 'border-[hsl(var(--border))] bg-white text-black hover:bg-[hsl(var(--bg))]'}`}>Preparation</Link>
                    <Link href={nextLiveHref} scroll={false} className={`inline-flex items-center justify-center rounded-2xl border px-4 py-2 text-sm font-medium transition ${filters.view === 'live' ? 'border-black bg-black text-white' : 'border-[hsl(var(--border))] bg-white text-black hover:bg-[hsl(var(--bg))]'}`}>Live mode</Link>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {BELT_PROMOTION_EVENT_STATUSES.map((status) => (
                    <form key={status} action={setEventStatusAction}>
                      <input type="hidden" name="eventId" value={selectedEvent.id} />
                      <input type="hidden" name="status" value={status} />
                      <input type="hidden" name="nextHref" value={filters.view === 'live' ? nextLiveHref : nextPrepHref} />
                      <button type="submit" className={`inline-flex items-center justify-center rounded-2xl border px-3 py-2 text-xs font-medium transition ${selectedEvent.status === status ? 'border-black bg-black text-white' : 'border-[hsl(var(--border))] bg-white text-black hover:bg-[hsl(var(--bg))]'}`}>
                        {titleCase(status)}
                      </button>
                    </form>
                  ))}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4"><div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Candidates</div><div className="mt-2 text-2xl font-semibold tracking-tight">{summary.total}</div></div>
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4"><div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Present / absent</div><div className="mt-2 text-2xl font-semibold tracking-tight">{summary.present} / {summary.absent}</div></div>
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4"><div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Confirmed / deferred</div><div className="mt-2 text-2xl font-semibold tracking-tight">{summary.confirmed} / {summary.deferred}</div></div>
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4"><div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Belts / certifs</div><div className="mt-2 text-2xl font-semibold tracking-tight">{summary.deliveredBelts} / {summary.deliveredCertificates}</div></div>
                </div>
              </section>

              <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
                <section className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold tracking-tight">Apply confirmed results</h3>
                      <p className="mt-1 text-xs text-[hsl(var(--muted))]">Apply all confirmed results globally with one final confirmation. This writes belt promotions, stripes, and athlete progress history.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <TinyBadge tone="success">{summary.applied} applied</TinyBadge>
                      <TinyBadge tone={summary.pendingApply > 0 ? 'warning' : 'neutral'}>{summary.pendingApply} pending apply</TinyBadge>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4"><div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Confirmed waiting</div><div className="mt-2 text-2xl font-semibold tracking-tight">{summary.pendingApply}</div></div>
                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4"><div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Already applied</div><div className="mt-2 text-2xl font-semibold tracking-tight">{summary.applied}</div></div>
                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4"><div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Last apply run</div><div className="mt-2 text-lg font-semibold tracking-tight">{latestApplyRun ? fmtDate(latestApplyRun.created_at) : 'None yet'}</div></div>
                  </div>

                  <form action={applyConfirmedResultsAction} className="mt-4 grid gap-3 rounded-2xl border border-[hsl(var(--border))] p-4">
                    <input type="hidden" name="eventId" value={selectedEvent.id} />
                    <input type="hidden" name="nextHref" value={filters.view === 'live' ? nextLiveHref : nextPrepHref} />
                    <label className="inline-flex items-center gap-2 rounded-2xl border border-[hsl(var(--border))] px-3 py-3 text-sm">
                      <input type="checkbox" name="confirm_apply" value="yes" />
                      I confirm that all currently confirmed results should be applied now.
                    </label>
                    <label className="inline-flex items-center gap-2 rounded-2xl border border-[hsl(var(--border))] px-3 py-3 text-sm">
                      <input type="checkbox" name="close_event_after" />
                      Close the event automatically after applying results.
                    </label>
                    <div className="text-xs text-[hsl(var(--muted))]">Confirmed candidates already applied will be skipped automatically.</div>
                    <div className="flex justify-end">
                      <button type="submit" disabled={summary.pendingApply === 0} className={`inline-flex items-center justify-center rounded-2xl border px-4 py-2 text-sm font-medium transition ${summary.pendingApply === 0 ? 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-[hsl(var(--muted))]' : 'border-black bg-black text-white hover:opacity-90'}`}>
                        Apply confirmed results
                      </button>
                    </div>
                  </form>
                </section>

                <section className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold tracking-tight">Apply history</h3>
                      <p className="mt-1 text-xs text-[hsl(var(--muted))]">Global apply runs for this event.</p>
                    </div>
                    <TinyBadge>{applyRuns.length}</TinyBadge>
                  </div>
                  <div className="mt-4 grid gap-3">
                    {applyRuns.length === 0 ? (
                      <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm text-[hsl(var(--muted))]">No apply run yet.</div>
                    ) : applyRuns.map((run) => (
                      <div key={run.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <TinyBadge tone="success">{run.applied_count} applied</TinyBadge>
                          <TinyBadge>{fmtDate(run.created_at)}</TinyBadge>
                          {run.closed_event ? <TinyBadge tone="warning">Closed event</TinyBadge> : null}
                        </div>
                        <div className="mt-2 text-sm text-black">Stripes {run.stripe_count} · Belts {run.belt_count} · Notes {run.note_count}</div>
                        {run.notes ? <p className="mt-2 text-sm text-[hsl(var(--muted))]">{run.notes}</p> : null}
                      </div>
                    ))}
                  </div>
                </section>
              </section>

              {filters.view === 'prep' ? (
                <>
                  <section className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                    <div>
                      <h3 className="text-sm font-semibold tracking-tight">Event setup</h3>
                      <p className="mt-1 text-xs text-[hsl(var(--muted))]">Keep this stage for preparation only. Live decisions happen in Live mode.</p>
                    </div>
                    <form action={saveEventAction} className="mt-4 grid gap-3">
                      <input type="hidden" name="eventId" value={selectedEvent.id} />
                      <input type="hidden" name="nextHref" value={nextPrepHref} />
                      <div className="grid gap-3 xl:grid-cols-2">
                        <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Title</span><input type="text" name="title" defaultValue={selectedEvent.title} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                        <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Status</span><select name="status" defaultValue={selectedEvent.status} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black">{BELT_PROMOTION_EVENT_STATUSES.map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}</select></label>
                        <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Date</span><input type="date" name="event_date" defaultValue={selectedEvent.event_date} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                        <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Time</span><input type="time" name="event_time" defaultValue={selectedEvent.event_time ?? ''} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                        <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Audience</span><select name="audience" defaultValue={selectedEvent.audience} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black">{BELT_PROMOTION_AUDIENCES.map((option) => <option key={option} value={option}>{eventAudienceLabel(option)}</option>)}</select></label>
                      </div>
                      <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Internal notes</span><textarea name="notes" rows={3} defaultValue={selectedEvent.notes ?? ''} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                      <div className="flex justify-end"><button type="submit" className="inline-flex items-center justify-center rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">Save event</button></div>
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
                            <input type="hidden" name="nextHref" value={nextPrepHref} />
                            <button type="submit" className="inline-flex items-center justify-center rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">Add top suggestions</button>
                          </form>
                        </div>
                        <div className="mt-4 grid gap-3">
                          {suggestions.slice(0, 8).map((row) => (
                            <div key={row.member_user_id} className="rounded-2xl border border-[hsl(var(--border))] p-4">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="font-medium leading-tight text-black">{row.athlete_name}</div>
                                  <div className="mt-1 text-xs text-[hsl(var(--muted))]">{row.member_id ?? 'No member ID'} · {titleCase(row.program_level ?? 'pending')} · {titleCase(row.age_group)}</div>
                                </div>
                                <TinyBadge tone={preparationTone(row.preparation_status)}>{titleCase(row.preparation_status)}</TinyBadge>
                              </div>
                              <div className="mt-3 text-sm text-black">{decisionLabel(row.proposed_decision, row.proposed_belt, row.proposed_stripes)}</div>
                              <p className="mt-2 text-xs text-[hsl(var(--muted))]">{row.promotion_reason}</p>
                            </div>
                          ))}
                        </div>
                      </section>

                      <section className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                        <div>
                          <h3 className="text-sm font-semibold tracking-tight">Event candidates</h3>
                          <p className="mt-1 text-xs text-[hsl(var(--muted))]">Preparation-only editing before the event starts.</p>
                        </div>
                        <div className="mt-4 grid gap-3">
                          {enrichedCandidates.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-8 text-center text-sm text-[hsl(var(--muted))]">No candidate added yet.</div>
                          ) : enrichedCandidates.map((row) => (
                            <form key={row.id} action={savePreparationCandidateAction} className="grid gap-3 rounded-2xl border border-[hsl(var(--border))] p-4">
                              <input type="hidden" name="eventId" value={selectedEvent.id} />
                              <input type="hidden" name="candidateId" value={row.id} />
                              <input type="hidden" name="nextHref" value={nextPrepHref} />
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                  <div className="font-medium leading-tight text-black">{row.athlete_name}</div>
                                  <div className="mt-1 text-xs text-[hsl(var(--muted))]">{row.member_id ?? 'No member ID'} · {titleCase(row.program_level ?? 'pending')} · {titleCase(row.role ?? 'member')}</div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <TinyBadge tone={preparationTone(row.preparation_status)}>{titleCase(row.preparation_status)}</TinyBadge>
                                  <TinyBadge tone={paymentTone(row.payment_status)}>{titleCase(row.payment_status)}</TinyBadge>
                                </div>
                              </div>
                              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Decision</span><select name="proposed_decision" defaultValue={row.proposed_decision} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black">{BELT_PROMOTION_DECISIONS.map((option) => <option key={option} value={option}>{titleCase(option)}</option>)}</select></label>
                                <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Belt</span><select name="proposed_belt" defaultValue={row.proposed_belt ?? ''} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"><option value="">No belt change</option>{beltTrackForAgeGroup(row.age_group).map((belt) => <option key={belt} value={belt}>{titleCase(belt)}</option>)}</select></label>
                                <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Stripes</span><input type="number" min={0} max={4} name="proposed_stripes" defaultValue={Number(row.proposed_stripes ?? row.current_stripes ?? 0)} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                                <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Prep status</span><select name="preparation_status" defaultValue={row.preparation_status} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black">{BELT_PROMOTION_PREPARATION_STATUSES.map((option) => <option key={option} value={option}>{titleCase(option)}</option>)}</select></label>
                                <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Payment</span><select name="payment_status" defaultValue={row.payment_status} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black">{BELT_PROMOTION_PAYMENT_STATUSES.map((option) => <option key={option} value={option}>{titleCase(option)}</option>)}</select></label>
                                <label className="block text-sm xl:col-span-2"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Reference coach</span><select name="reference_coach_user_id" defaultValue={row.reference_coach_user_id ?? ''} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"><option value="">No reference coach</option>{(coachesRes.data ?? []).map((coach) => <option key={coach.user_id} value={coach.user_id}>{fullName(coach.first_name, coach.last_name, coach.role ? titleCase(coach.role) : 'Coach')}</option>)}</select></label>
                              </div>
                              <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Head coach note</span><textarea name="head_coach_note" rows={3} defaultValue={row.head_coach_note ?? ''} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                              <div className="flex flex-wrap justify-between gap-2">
                                <button type="submit" className="inline-flex items-center justify-center rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">Save candidate</button>
                                <button type="submit" formAction={removeCandidateAction} className="inline-flex items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100">Remove</button>
                              </div>
                            </form>
                          ))}
                        </div>
                      </section>
                    </div>

                    <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
                      <section className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                        <div>
                          <h3 className="text-sm font-semibold tracking-tight">Add candidate manually</h3>
                          <p className="mt-1 text-xs text-[hsl(var(--muted))]">Search from the Head Coach roster and add one athlete to the event.</p>
                        </div>
                        <form className="mt-4 flex gap-2" action={nextPrepHref}>
                          <input type="hidden" name="event" value={selectedEvent.id} />
                          <input type="hidden" name="view" value="prep" />
                          <input type="text" name="q" defaultValue={filters.q} placeholder="Search athlete" className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" />
                          <button type="submit" className="inline-flex items-center justify-center rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">Search</button>
                        </form>
                        <div className="mt-4 grid gap-3">
                          {manualResults.length === 0 ? (
                            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm text-[hsl(var(--muted))]">No athlete found for this search.</div>
                          ) : manualResults.map((row) => (
                            <form key={row.member_user_id} action={addCandidateAction} className="grid gap-3 rounded-2xl border border-[hsl(var(--border))] p-4">
                              <input type="hidden" name="eventId" value={selectedEvent.id} />
                              <input type="hidden" name="nextHref" value={nextPrepHref} />
                              <input type="hidden" name="member_user_id" value={row.member_user_id} />
                              <input type="hidden" name="athlete_name" value={row.athlete_name} />
                              <input type="hidden" name="current_belt" value={row.current_belt ?? ''} />
                              <input type="hidden" name="current_stripes" value={row.current_stripes} />
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="font-medium leading-tight text-black">{row.athlete_name}</div>
                                  <div className="mt-1 text-xs text-[hsl(var(--muted))]">{row.member_id ?? 'No member ID'} · {titleCase(row.program_level ?? 'pending')} · {titleCase(row.age_group)}</div>
                                </div>
                                <TinyBadge tone={preparationTone(row.preparation_status)}>{titleCase(row.preparation_status)}</TinyBadge>
                              </div>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Decision</span><select name="proposed_decision" defaultValue={row.proposed_decision} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black">{BELT_PROMOTION_DECISIONS.map((option) => <option key={option} value={option}>{titleCase(option)}</option>)}</select></label>
                                <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Prep status</span><select name="preparation_status" defaultValue={row.preparation_status} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black">{BELT_PROMOTION_PREPARATION_STATUSES.map((option) => <option key={option} value={option}>{titleCase(option)}</option>)}</select></label>
                                <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Belt</span><select name="proposed_belt" defaultValue={row.proposed_belt ?? ''} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black"><option value="">No belt change</option>{beltTrackForAgeGroup(row.age_group).map((belt) => <option key={belt} value={belt}>{titleCase(belt)}</option>)}</select></label>
                                <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Stripes</span><input type="number" min={0} max={4} name="proposed_stripes" defaultValue={Number(row.proposed_stripes ?? row.current_stripes ?? 0)} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                              </div>
                              <input type="hidden" name="reference_coach_user_id" value={row.reference_coach_user_id ?? ''} />
                              <input type="hidden" name="head_coach_note" value={row.head_coach_note ?? ''} />
                              <button type="submit" className="inline-flex items-center justify-center rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">Add candidate</button>
                            </form>
                          ))}
                        </div>
                      </section>

                      <section className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                        <div>
                          <h3 className="text-sm font-semibold tracking-tight">Recent event activity</h3>
                          <p className="mt-1 text-xs text-[hsl(var(--muted))]">Lightweight log for preparation changes.</p>
                        </div>
                        <div className="mt-4 grid gap-3">
                          {logs.length === 0 ? (
                            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm text-[hsl(var(--muted))]">No activity yet.</div>
                          ) : logs.map((log) => (
                            <div key={log.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
                              <div className="flex flex-wrap items-center gap-2"><TinyBadge>{titleCase(log.action)}</TinyBadge><TinyBadge>{fmtDate(log.created_at)}</TinyBadge></div>
                              {log.details ? <p className="mt-2 text-sm text-[hsl(var(--muted))]">{log.details}</p> : null}
                            </div>
                          ))}
                        </div>
                      </section>
                    </div>
                  </section>
                </>
              ) : (
                <section className="space-y-4">
                  <section className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold tracking-tight">Live event mode</h3>
                        <p className="mt-1 text-xs text-[hsl(var(--muted))]">Fast terrain-friendly workflow: mark presence, set final decision, track payment, and record belt/certificate delivery.</p>
                      </div>
                      <form className="flex gap-2" action={nextLiveHref}>
                        <input type="hidden" name="event" value={selectedEvent.id} />
                        <input type="hidden" name="view" value="live" />
                        <input type="text" name="q" defaultValue={filters.q} placeholder="Search live queue" className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black sm:w-64" />
                        <button type="submit" className="inline-flex items-center justify-center rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">Search</button>
                      </form>
                    </div>
                  </section>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft"><div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Ready</div><div className="mt-2 text-2xl font-semibold tracking-tight">{liveCandidates.filter((row) => liveState(row) === 'ready').length}</div></div>
                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft"><div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Needs action</div><div className="mt-2 text-2xl font-semibold tracking-tight">{liveCandidates.filter((row) => liveState(row) === 'attention').length}</div></div>
                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft"><div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Done</div><div className="mt-2 text-2xl font-semibold tracking-tight">{liveCandidates.filter((row) => liveState(row) === 'done').length}</div></div>
                    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft"><div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Absent</div><div className="mt-2 text-2xl font-semibold tracking-tight">{liveCandidates.filter((row) => liveState(row) === 'absent').length}</div></div>
                  </div>

                  <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                    <div className="space-y-3">
                      {liveCandidates.length === 0 ? (
                        <div className="rounded-3xl border border-dashed border-[hsl(var(--border))] bg-white px-4 py-10 text-center text-sm text-[hsl(var(--muted))] shadow-soft">No candidate matches the current live filters.</div>
                      ) : liveCandidates.map((row) => {
                        const state = liveState(row)
                        return (
                          <div key={row.id} className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div>
                                <div className="text-base font-semibold leading-tight text-black">{row.athlete_name}</div>
                                <div className="mt-1 flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
                                  <span>{row.member_id ?? 'No member ID'}</span>
                                  <span>{titleCase(row.program_level ?? 'pending')}</span>
                                  <span>{titleCase(row.role ?? 'member')}</span>
                                  <span>{row.reference_coach_name || 'No reference coach'}</span>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <TinyBadge tone={liveStateTone(state)}>{liveStateLabel(state)}</TinyBadge>
                                <TinyBadge tone={paymentTone(row.payment_status)}>{titleCase(row.payment_status)}</TinyBadge>
                                <TinyBadge tone={finalDecisionTone(row.final_decision)}>{titleCase(row.final_decision)}</TinyBadge>
                              </div>
                            </div>

                            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-3"><div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Planned</div><div className="mt-1 text-sm font-medium text-black">{decisionLabel(row.proposed_decision, row.proposed_belt, row.proposed_stripes)}</div></div>
                              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-3"><div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Attendance</div><div className="mt-1 text-sm font-medium text-black">{titleCase(row.attendance_status)}</div></div>
                              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-3"><div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Belt</div><div className="mt-1 text-sm font-medium text-black">{row.belt_delivered ? 'Delivered' : 'Pending'}</div></div>
                              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-3"><div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Certificate</div><div className="mt-1 text-sm font-medium text-black">{row.certificate_delivered ? 'Delivered' : 'Pending'}</div></div>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2">
                              {['present', 'confirm', 'defer', 'paid', 'waived', 'belt_delivered', 'certificate_delivered', 'absent'].map((kind) => (
                                <form key={kind} action={quickLiveAction}>
                                  <input type="hidden" name="eventId" value={selectedEvent.id} />
                                  <input type="hidden" name="candidateId" value={row.id} />
                                  <input type="hidden" name="kind" value={kind} />
                                  <input type="hidden" name="nextHref" value={nextLiveHref} />
                                  <button type="submit" className={`inline-flex items-center justify-center rounded-2xl border px-3 py-2 text-xs font-medium transition ${kind === 'confirm' || kind === 'paid' ? 'border-black bg-black text-white hover:opacity-90' : 'border-[hsl(var(--border))] bg-white text-black hover:bg-[hsl(var(--bg))]'}`}>
                                    {kind === 'present' ? 'Mark present' : kind === 'confirm' ? 'Confirm' : kind === 'defer' ? 'Defer' : kind === 'paid' ? 'Paid' : kind === 'waived' ? 'Waived' : kind === 'belt_delivered' ? 'Belt delivered' : kind === 'certificate_delivered' ? 'Certificate delivered' : 'Absent'}
                                  </button>
                                </form>
                              ))}
                            </div>

                            <details className="mt-4 rounded-2xl border border-[hsl(var(--border))] p-3">
                              <summary className="cursor-pointer text-sm font-medium text-black">Advanced live edit</summary>
                              <form action={saveLiveCandidateAction} className="mt-3 grid gap-3">
                                <input type="hidden" name="eventId" value={selectedEvent.id} />
                                <input type="hidden" name="candidateId" value={row.id} />
                                <input type="hidden" name="nextHref" value={nextLiveHref} />
                                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                  <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Attendance</span><select name="attendance_status" defaultValue={row.attendance_status} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black">{BELT_PROMOTION_ATTENDANCE_STATUSES.map((option) => <option key={option} value={option}>{titleCase(option)}</option>)}</select></label>
                                  <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Final decision</span><select name="final_decision" defaultValue={row.final_decision} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black">{BELT_PROMOTION_FINAL_DECISIONS.map((option) => <option key={option} value={option}>{titleCase(option)}</option>)}</select></label>
                                  <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Payment</span><select name="payment_status" defaultValue={row.payment_status} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black">{BELT_PROMOTION_PAYMENT_STATUSES.map((option) => <option key={option} value={option}>{titleCase(option)}</option>)}</select></label>
                                </div>
                                <label className="block text-sm"><span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Live note</span><textarea name="head_coach_note" rows={3} defaultValue={row.head_coach_note ?? ''} className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none transition focus:border-black" /></label>
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <label className="inline-flex items-center gap-2 rounded-2xl border border-[hsl(var(--border))] px-3 py-2 text-sm"><input type="checkbox" name="belt_delivered" defaultChecked={row.belt_delivered} /> Belt delivered</label>
                                  <label className="inline-flex items-center gap-2 rounded-2xl border border-[hsl(var(--border))] px-3 py-2 text-sm"><input type="checkbox" name="certificate_delivered" defaultChecked={row.certificate_delivered} /> Certificate delivered</label>
                                </div>
                                <div className="flex justify-end"><button type="submit" className="inline-flex items-center justify-center rounded-2xl border border-black bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">Save live state</button></div>
                              </form>
                            </details>
                          </div>
                        )
                      })}
                    </div>

                    <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
                      <section className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                        <div>
                          <h3 className="text-sm font-semibold tracking-tight">Live checklist</h3>
                          <p className="mt-1 text-xs text-[hsl(var(--muted))]">Use the quick actions first. Open Advanced live edit only when you need a specific correction.</p>
                        </div>
                        <div className="mt-4 grid gap-3 text-sm text-[hsl(var(--muted))]">
                          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3"><span className="font-medium text-black">1.</span> Mark present or absent.</div>
                          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3"><span className="font-medium text-black">2.</span> Record final decision: confirm / defer / reject.</div>
                          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3"><span className="font-medium text-black">3.</span> Update internal payment state.</div>
                          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3"><span className="font-medium text-black">4.</span> Mark belt / certificate delivered if applicable.</div>
                        </div>
                      </section>

                      <section className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                        <div>
                          <h3 className="text-sm font-semibold tracking-tight">Recent live activity</h3>
                          <p className="mt-1 text-xs text-[hsl(var(--muted))]">Latest event actions while running the event.</p>
                        </div>
                        <div className="mt-4 grid gap-3">
                          {logs.length === 0 ? (
                            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3 text-sm text-[hsl(var(--muted))]">No activity yet.</div>
                          ) : logs.map((log) => (
                            <div key={log.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
                              <div className="flex flex-wrap items-center gap-2"><TinyBadge>{titleCase(log.action)}</TinyBadge><TinyBadge>{fmtDate(log.created_at)}</TinyBadge></div>
                              {log.details ? <p className="mt-2 text-sm text-[hsl(var(--muted))]">{log.details}</p> : null}
                            </div>
                          ))}
                        </div>
                      </section>
                    </div>
                  </section>
                </section>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  )
}
