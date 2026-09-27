import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { cairoToday } from '@/lib/cairoDate'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import PromotionCorrectionNotice from '@/components/belt-promotions/PromotionCorrectionNotice'

type ProgressEventRow = {
  id: string
  member_user_id: string
  event_type: 'stripe_award' | 'belt_promotion'
  effective_date: string
  previous_belt_code: string | null
  next_belt_code: string | null
  previous_stripes: number | null
  next_stripes: number | null
  notes: string | null
  created_at: string
  created_by: string | null
}

type CorrectionRow = {
  progress_event_id: string
  reason: string
  corrected_at: string
  corrected_by: string | null
}

type ProfileRow = {
  user_id: string
  member_id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
}

const CEREMONY_DATE_COOKIE = 'promotion_desk_ceremony_date'

function displayName(profile?: ProfileRow | null) {
  if (!profile) return 'Unknown'
  const name = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim()
  return name || profile.email || profile.member_id || 'Unknown'
}

function beltLabel(value?: string | null) {
  if (!value) return '—'
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function stripeLabel(value?: number | null) {
  const n = Math.max(0, Number(value ?? 0))
  return `${n} stripe${n === 1 ? '' : 's'}`
}

function rankChange(event: ProgressEventRow) {
  if (event.event_type === 'belt_promotion') {
    const previous = beltLabel(event.previous_belt_code || 'white')
    const next = beltLabel(event.next_belt_code)
    return `${previous} → ${next}`
  }
  return `${stripeLabel(event.previous_stripes)} → ${stripeLabel(event.next_stripes)}`
}

function cairoTime(value?: string | null) {
  if (!value) return '—'
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(dt)
}

function isIsoDate(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const dt = new Date(Date.UTC(year, month - 1, day))
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  )
}

function shiftIsoDate(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number)
  const dt = new Date(Date.UTC(year, month - 1, day))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

function correctionErrorCode(message: string) {
  const value = message.toLowerCase()
  if (value.includes('forbidden')) return 'forbidden'
  if (value.includes('not_found')) return 'not_found'
  if (value.includes('already_corrected')) return 'already_corrected'
  if (value.includes('later_promotion')) return 'later_promotion'
  if (value.includes('state_changed') || value.includes('current_state')) return 'state_changed'
  if (value.includes('reason_required')) return 'invalid'
  return 'failed'
}

async function setCeremonyDateAction(formData: FormData) {
  'use server'

  const me = await getSessionUserCached()
  if (!me || (me.role !== 'head_coach' && me.role !== 'super_admin')) {
    redirect('/head-coach/promotion-desk')
  }

  const today = cairoToday()
  const requested = String(formData.get('ceremony_date') || '').trim()
  const selectedDate =
    isIsoDate(requested) && requested <= today ? requested : today

  cookies().set(CEREMONY_DATE_COOKIE, selectedDate, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/head-coach/promotion-desk',
    maxAge: 60 * 60 * 24 * 90,
  })

  revalidatePath('/head-coach/promotion-desk')
  redirect('/head-coach/promotion-desk')
}

async function undoPromotionAction(formData: FormData) {
  'use server'

  const eventId = String(formData.get('progress_event_id') || '').trim()
  const reason = String(formData.get('reason') || '').trim().slice(0, 1000)
  const confirmed = String(formData.get('confirm') || '') === 'yes'

  const me = await getSessionUserCached()
  if (!me || (me.role !== 'head_coach' && me.role !== 'super_admin')) {
    redirect('/head-coach/promotion-desk?correction_error=forbidden')
  }

  if (!eventId || reason.length < 3 || !confirmed) {
    redirect('/head-coach/promotion-desk?correction_error=invalid')
  }

  const admin = getSupabaseAdminClientCached()

  // Same-day correction only. The RPC repeats state/order safeguards transactionally.
  const event = await admin
    .from('member_athlete_progress_events')
    .select('id,effective_date,member_user_id')
    .eq('id', eventId)
    .maybeSingle<{ id: string; effective_date: string; member_user_id: string }>()

  if (event.error || !event.data) {
    redirect('/head-coach/promotion-desk?correction_error=not_found')
  }

  if (event.data.effective_date !== cairoToday()) {
    redirect('/head-coach/promotion-desk?correction_error=invalid')
  }

  const result = await admin.rpc('undo_promotion_desk_event', {
    p_progress_event_id: eventId,
    p_reason: reason,
    p_actor_user_id: me.id,
  })

  if (result.error) {
    const code = correctionErrorCode(result.error.message || '')
    redirect(`/head-coach/promotion-desk?correction_error=${code}`)
  }

  revalidatePath('/head-coach/promotion-desk')
  revalidatePath('/head-coach/athletes')
  revalidatePath(`/members/${event.data.member_user_id}`)
  redirect('/head-coach/promotion-desk?correction=ok')
}

export default async function PromotionCeremonyLog() {
  const me = await getSessionUserCached()
  if (!me || (me.role !== 'head_coach' && me.role !== 'super_admin')) return null

  const admin = getSupabaseAdminClientCached()
  const today = cairoToday()
  const yesterday = shiftIsoDate(today, -1)

  const storedDate = cookies().get(CEREMONY_DATE_COOKIE)?.value ?? ''
  const selectedDate =
    isIsoDate(storedDate) && storedDate <= today ? storedDate : today
  const viewingToday = selectedDate === today
  const viewingYesterday = selectedDate === yesterday

  const eventsRes = await admin
    .from('member_athlete_progress_events')
    .select('id,member_user_id,event_type,effective_date,previous_belt_code,next_belt_code,previous_stripes,next_stripes,notes,created_at,created_by')
    .eq('effective_date', selectedDate)
    .in('event_type', ['stripe_award', 'belt_promotion'])
    .like('notes', 'Promotion Desk · %')
    .order('created_at', { ascending: false })
    .limit(250)
    .returns<ProgressEventRow[]>()

  if (eventsRes.error) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 pt-4 sm:px-6">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Ceremony Log could not load: {eventsRes.error.message}
        </div>
      </div>
    )
  }

  const events = eventsRes.data ?? []
  const eventIds = events.map((event) => event.id)

  let corrections: CorrectionRow[] = []
  let migrationReady = true

  if (eventIds.length) {
    const correctionsRes = await admin
      .from('promotion_desk_corrections')
      .select('progress_event_id,reason,corrected_at,corrected_by')
      .in('progress_event_id', eventIds)
      .returns<CorrectionRow[]>()

    if (correctionsRes.error) {
      migrationReady = false
    } else {
      corrections = correctionsRes.data ?? []
    }
  }

  const correctedByEvent = new Map(corrections.map((row) => [row.progress_event_id, row]))
  const activeEvents = events.filter((event) => !correctedByEvent.has(event.id))

  const profileIds = Array.from(
    new Set(
      events
        .flatMap((event) => [event.member_user_id, event.created_by])
        .concat(corrections.map((row) => row.corrected_by))
        .filter((value): value is string => !!value),
    ),
  )

  const profilesRes = profileIds.length
    ? await admin
        .from('profiles')
        .select('user_id,member_id,first_name,last_name,email')
        .in('user_id', profileIds)
        .returns<ProfileRow[]>()
    : { data: [] as ProfileRow[], error: null }

  const profiles = new Map((profilesRes.data ?? []).map((profile) => [profile.user_id, profile]))

  const latestActiveByMember = new Map<string, string>()
  for (const event of activeEvents) {
    if (!latestActiveByMember.has(event.member_user_id)) {
      latestActiveByMember.set(event.member_user_id, event.id)
    }
  }

  const stripeCount = activeEvents.filter((event) => event.event_type === 'stripe_award').length
  const beltCount = activeEvents.filter((event) => event.event_type === 'belt_promotion').length
  const correctedCount = corrections.length

  return (
    <aside className="mx-auto w-full max-w-5xl px-4 pt-4 sm:px-6">
      <PromotionCorrectionNotice />

      <section className="rounded-3xl border border-black/10 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
              Ceremony Log · {selectedDate}
            </div>
            <h2 className="mt-1 text-lg font-bold">
              {viewingToday ? 'Promotions today' : `Promotions on ${selectedDate}`}
            </h2>
            <p className="mt-1 text-xs text-[hsl(var(--muted))]">
              {viewingToday
                ? 'Live audit of promotions applied through Promotion Desk. Corrected entries remain visible.'
                : 'Historical Promotion Desk audit. Corrections remain visible; undo is disabled outside today.'}
            </p>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="rounded-xl bg-black/[0.035] px-3 py-2">
              <div className="text-lg font-bold">{activeEvents.length}</div>
              <div className="text-[10px] uppercase text-[hsl(var(--muted))]">Active</div>
            </div>
            <div className="rounded-xl bg-violet-50 px-3 py-2">
              <div className="text-lg font-bold text-violet-900">{stripeCount}</div>
              <div className="text-[10px] uppercase text-violet-700">Stripes</div>
            </div>
            <div className="rounded-xl bg-emerald-50 px-3 py-2">
              <div className="text-lg font-bold text-emerald-900">{beltCount}</div>
              <div className="text-[10px] uppercase text-emerald-700">Belts</div>
            </div>
            <div className="rounded-xl bg-amber-50 px-3 py-2">
              <div className="text-lg font-bold text-amber-900">{correctedCount}</div>
              <div className="text-[10px] uppercase text-amber-700">Corrected</div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-black/10 bg-black/[0.015] p-3 sm:flex-row sm:items-end">
          <div className="flex gap-2">
            <form action={setCeremonyDateAction}>
              <input type="hidden" name="ceremony_date" value={yesterday} />
              <button
                type="submit"
                className={
                  'rounded-xl border px-3 py-2 text-xs font-semibold ' +
                  (viewingYesterday
                    ? 'border-black bg-black text-white'
                    : 'border-black/10 bg-white hover:bg-black/[0.03]')
                }
              >
                Yesterday
              </button>
            </form>

            <form action={setCeremonyDateAction}>
              <input type="hidden" name="ceremony_date" value={today} />
              <button
                type="submit"
                className={
                  'rounded-xl border px-3 py-2 text-xs font-semibold ' +
                  (viewingToday
                    ? 'border-black bg-black text-white'
                    : 'border-black/10 bg-white hover:bg-black/[0.03]')
                }
              >
                Today
              </button>
            </form>
          </div>

          <form action={setCeremonyDateAction} className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end sm:justify-end">
            <label className="text-xs font-medium">
              Ceremony date
              <input
                type="date"
                name="ceremony_date"
                defaultValue={selectedDate}
                max={today}
                required
                className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm sm:w-auto"
              />
            </label>
            <button
              type="submit"
              className="rounded-xl border border-black/10 bg-white px-4 py-2 text-xs font-semibold hover:bg-black/[0.03]"
            >
              View date
            </button>
          </form>
        </div>

        {!viewingToday ? (
          <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
            Historical view · You can review profiles and audit entries, but promotions from past dates cannot be undone here.
          </div>
        ) : null}

        {!migrationReady ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Deploy the Belt Promotions 2A database migration to enable correction audit and safe undo.
            The selected ceremony log remains readable.
          </div>
        ) : null}

        <details className="group mt-4">
          <summary className="flex cursor-pointer list-none items-center justify-between rounded-2xl border border-black/10 bg-black/[0.02] px-4 py-3 text-sm font-semibold marker:content-none">
            <span>
              {viewingToday ? "View today's ceremony log" : `View ceremony log · ${selectedDate}`}
            </span>
            <span className="text-xs font-normal text-[hsl(var(--muted))] group-open:hidden">Open</span>
            <span className="hidden text-xs font-normal text-[hsl(var(--muted))] group-open:inline">Close</span>
          </summary>

          {events.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-dashed border-black/10 p-5 text-center text-sm text-[hsl(var(--muted))]">
              {viewingToday
                ? 'No Promotion Desk promotions recorded for today yet.'
                : `No Promotion Desk promotions recorded for ${selectedDate}.`}
            </div>
          ) : (
            <div className="mt-3 grid gap-3">
              {events.map((event) => {
                const member = profiles.get(event.member_user_id)
                const actor = event.created_by ? profiles.get(event.created_by) : null
                const correction = correctedByEvent.get(event.id)
                const correctionActor = correction?.corrected_by ? profiles.get(correction.corrected_by) : null
                const isLatestActive = latestActiveByMember.get(event.member_user_id) === event.id
                const canUndo = viewingToday && migrationReady && !correction && isLatestActive

                return (
                  <div
                    key={event.id}
                    className={
                      'rounded-2xl border p-4 ' +
                      (correction
                        ? 'border-amber-200 bg-amber-50/60'
                        : event.event_type === 'belt_promotion'
                          ? 'border-emerald-200 bg-emerald-50/40'
                          : 'border-violet-200 bg-violet-50/40')
                    }
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{displayName(member)}</span>
                          {member?.member_id ? (
                            <span className="text-xs text-[hsl(var(--muted))]">{member.member_id}</span>
                          ) : null}
                          <span className="rounded-full border border-black/10 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase">
                            {event.event_type === 'belt_promotion' ? 'Belt' : 'Stripe'}
                          </span>
                          {correction ? (
                            <span className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-900">
                              Corrected
                            </span>
                          ) : (
                            <span className="rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-900">
                              Active
                            </span>
                          )}
                        </div>

                        <div className={'mt-2 text-base font-bold ' + (correction ? 'line-through opacity-60' : '')}>
                          {rankChange(event)}
                        </div>

                        <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                          {cairoTime(event.created_at)} · Applied by {displayName(actor)}
                        </div>

                        {correction ? (
                          <div className="mt-3 rounded-xl border border-amber-200 bg-white/80 p-3 text-xs text-amber-950">
                            <div className="font-semibold">Correction: {correction.reason}</div>
                            <div className="mt-1">
                              Corrected {cairoTime(correction.corrected_at)} by {displayName(correctionActor)}
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/members/${event.member_user_id}`}
                          className="rounded-xl border border-black/10 bg-white px-3 py-2 text-xs font-semibold hover:bg-black/[0.03]"
                        >
                          Open profile
                        </Link>
                      </div>
                    </div>

                    {canUndo ? (
                      <details className="group mt-3 rounded-xl border border-rose-200 bg-white/80">
                        <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold text-rose-700 marker:content-none">
                          Correct / undo this promotion
                        </summary>
                        <form action={undoPromotionAction} className="border-t border-rose-100 p-3">
                          <input type="hidden" name="progress_event_id" value={event.id} />
                          <label className="block text-xs font-medium text-rose-900">
                            Correction reason
                            <textarea
                              name="reason"
                              minLength={3}
                              maxLength={1000}
                              required
                              rows={2}
                              placeholder="Example: wrong stripe selected during ceremony"
                              className="mt-1 w-full rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm"
                            />
                          </label>
                          <label className="mt-3 flex items-start gap-2 text-xs text-rose-900">
                            <input type="checkbox" name="confirm" value="yes" required className="mt-0.5" />
                            <span>
                              I confirm this should be undone. The original event will remain visible as corrected,
                              and the member&apos;s previous grade/stripes will be restored.
                            </span>
                          </label>
                          <button
                            type="submit"
                            className="mt-3 rounded-xl bg-rose-700 px-4 py-2 text-xs font-bold text-white"
                          >
                            Undo promotion
                          </button>
                        </form>
                      </details>
                    ) : !correction && !viewingToday ? (
                      <div className="mt-3 text-[11px] text-[hsl(var(--muted))]">
                        Historical entry · Undo is available only for today&apos;s promotions.
                      </div>
                    ) : !correction && migrationReady ? (
                      <div className="mt-3 text-[11px] text-[hsl(var(--muted))]">
                        A later promotion exists for this member. Correct the latest active promotion first.
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </details>
      </section>
    </aside>
  )
}
