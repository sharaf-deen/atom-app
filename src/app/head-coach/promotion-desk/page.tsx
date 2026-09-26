export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import { cairoToday } from '@/lib/cairoDate'
import {
  BELT_PROMOTION_TARGET_ROLES,
  fullName,
  normalizeStripes,
  type BeltPromotionRosterRow,
} from '@/lib/beltPromotionEvents'
import {
  ADULT_BELTS,
  ageGroupFromDate,
  beltTrackForAgeGroup,
  fmtDate,
  titleCase,
} from '@/lib/headCoachAthletes'

type SearchParams = Record<string, string | string[] | undefined>

type PromotionError =
  | 'member_not_found'
  | 'invalid_date'
  | 'future_date'
  | 'invalid_stripes'
  | 'stripe_not_higher'
  | 'invalid_belt'
  | 'belt_not_higher'
  | 'duplicate_belt'
  | 'save_failed'

function pick(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function buildHref(args: {
  q?: string
  member?: string
  saved?: string
  error?: PromotionError
}) {
  const qs = new URLSearchParams()
  if (args.q?.trim()) qs.set('q', args.q.trim())
  if (args.member?.trim()) qs.set('member', args.member.trim())
  if (args.saved?.trim()) qs.set('saved', args.saved.trim())
  if (args.error) qs.set('error', args.error)
  const query = qs.toString()
  return query ? `/head-coach/promotion-desk?${query}` : '/head-coach/promotion-desk'
}

function errorLabel(code: string) {
  if (code === 'member_not_found') return 'Member not found or not eligible for belt promotion management.'
  if (code === 'invalid_date') return 'Enter a valid promotion date.'
  if (code === 'future_date') return 'Promotion date cannot be in the future.'
  if (code === 'invalid_stripes') return 'Choose a valid stripe level from 1 to 4.'
  if (code === 'stripe_not_higher') return 'The new stripe level must be higher than the member’s current stripes.'
  if (code === 'invalid_belt') return 'Choose a belt that belongs to the member’s age track.'
  if (code === 'belt_not_higher') return 'The new belt must represent a forward promotion, not the current or a lower belt.'
  if (code === 'duplicate_belt') return 'This exact belt promotion is already recorded for that date.'
  return 'Promotion could not be saved. No further action was taken.'
}

function searchableText(row: BeltPromotionRosterRow) {
  return [
    row.first_name ?? '',
    row.last_name ?? '',
    row.member_id ?? '',
    row.email ?? '',
  ]
    .join(' ')
    .toLowerCase()
}

function memberMatches(row: BeltPromotionRosterRow, query: string) {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (!terms.length) return false
  const haystack = searchableText(row)
  return terms.every((term) => haystack.includes(term))
}

function allowedBeltTargets(row: BeltPromotionRosterRow) {
  const ageGroup = ageGroupFromDate(row.date_of_birth)
  const track = beltTrackForAgeGroup(ageGroup)
  const current = row.current_belt ?? null
  const currentIndex = current ? track.indexOf(current as any) : -1

  if (currentIndex >= 0) return track.slice(currentIndex + 1)

  if (
    ageGroup === 'adults' &&
    current &&
    ['grey', 'yellow', 'orange', 'green'].includes(current)
  ) {
    return [...ADULT_BELTS].slice(1)
  }

  return track.filter((belt) => belt !== current)
}

async function requirePromotionAccess(nextPath: string) {
  const me = await getSessionUserCached()
  if (!me || (me.role !== 'head_coach' && me.role !== 'super_admin')) {
    redirect(nextPath)
  }
  return me
}

async function applyPromotionAction(formData: FormData) {
  'use server'

  const memberUserId = String(formData.get('member_user_id') || '').trim()
  const promotionType = String(formData.get('promotion_type') || '').trim()
  const promotedAt = String(formData.get('promoted_at') || '').trim()
  const q = String(formData.get('q') || '').trim()
  const note = String(formData.get('note') || '').trim().slice(0, 1000) || null
  const nextPath = buildHref({ q, member: memberUserId })

  const me = await requirePromotionAccess(nextPath)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(promotedAt)) {
    redirect(buildHref({ q, member: memberUserId, error: 'invalid_date' }))
  }
  if (promotedAt > cairoToday()) {
    redirect(buildHref({ q, member: memberUserId, error: 'future_date' }))
  }

  const admin = getSupabaseAdminClientCached()
  const memberRes = await admin
    .from('head_coach_athlete_roster')
    .select('*')
    .eq('user_id', memberUserId)
    .maybeSingle<BeltPromotionRosterRow>()

  if (
    memberRes.error ||
    !memberRes.data ||
    !memberRes.data.role ||
    !BELT_PROMOTION_TARGET_ROLES.includes(memberRes.data.role)
  ) {
    redirect(buildHref({ q, error: 'member_not_found' }))
  }

  const member = memberRes.data
  const eventNote = `Promotion Desk · ${promotedAt}${note ? ` — ${note}` : ''}`

  if (promotionType === 'stripe') {
    const nextStripes = normalizeStripes(formData.get('new_stripes'))
    const currentStripes = normalizeStripes(member.stripes)

    if (nextStripes < 1 || nextStripes > 4) {
      redirect(buildHref({ q, member: memberUserId, error: 'invalid_stripes' }))
    }
    if (nextStripes <= currentStripes) {
      redirect(buildHref({ q, member: memberUserId, error: 'stripe_not_higher' }))
    }

    const upsert = await admin.from('member_training_profiles').upsert(
      {
        member_user_id: memberUserId,
        program_level: member.program_level ?? null,
        stripes: nextStripes,
        specialty: member.specialty ?? null,
        reference_coach_user_id: member.reference_coach_user_id ?? null,
        notes: member.coach_note ?? null,
        updated_by: me.id,
      },
      { onConflict: 'member_user_id' },
    )
    if (upsert.error) {
      redirect(buildHref({ q, member: memberUserId, error: 'save_failed' }))
    }

    const progress = await admin.from('member_athlete_progress_events').insert({
      id: crypto.randomUUID(),
      member_user_id: memberUserId,
      event_type: 'stripe_award',
      effective_date: promotedAt,
      previous_program_level: member.program_level ?? null,
      next_program_level: member.program_level ?? null,
      previous_stripes: currentStripes,
      next_stripes: nextStripes,
      notes: eventNote,
      created_by: me.id,
    })
    if (progress.error) {
      redirect(buildHref({ q, member: memberUserId, error: 'save_failed' }))
    }
  } else if (promotionType === 'belt') {
    const newBelt = String(formData.get('new_belt') || '').trim().toLowerCase()
    const allowed = allowedBeltTargets(member)
    if (!newBelt || !allowed.includes(newBelt as any)) {
      const track = beltTrackForAgeGroup(ageGroupFromDate(member.date_of_birth))
      if (!track.includes(newBelt as any)) {
        redirect(buildHref({ q, member: memberUserId, error: 'invalid_belt' }))
      }
      redirect(buildHref({ q, member: memberUserId, error: 'belt_not_higher' }))
    }

    const duplicate = await admin
      .from('member_belt_promotions')
      .select('id')
      .eq('member_user_id', memberUserId)
      .eq('belt_code', newBelt)
      .eq('promoted_at', promotedAt)
      .limit(1)
      .maybeSingle<{ id: string }>()
    if (duplicate.error) {
      redirect(buildHref({ q, member: memberUserId, error: 'save_failed' }))
    }
    if (duplicate.data?.id) {
      redirect(buildHref({ q, member: memberUserId, error: 'duplicate_belt' }))
    }

    const insertBelt = await admin.from('member_belt_promotions').insert({
      id: crypto.randomUUID(),
      member_user_id: memberUserId,
      belt_code: newBelt,
      promoted_at: promotedAt,
      notes: eventNote,
      created_by: me.id,
      updated_by: me.id,
    })
    if (insertBelt.error) {
      redirect(buildHref({ q, member: memberUserId, error: 'save_failed' }))
    }

    const currentStripes = normalizeStripes(member.stripes)
    const upsert = await admin.from('member_training_profiles').upsert(
      {
        member_user_id: memberUserId,
        program_level: member.program_level ?? null,
        stripes: 0,
        specialty: member.specialty ?? null,
        reference_coach_user_id: member.reference_coach_user_id ?? null,
        notes: member.coach_note ?? null,
        updated_by: me.id,
      },
      { onConflict: 'member_user_id' },
    )
    if (upsert.error) {
      redirect(buildHref({ q, member: memberUserId, error: 'save_failed' }))
    }

    const progress = await admin.from('member_athlete_progress_events').insert({
      id: crypto.randomUUID(),
      member_user_id: memberUserId,
      event_type: 'belt_promotion',
      effective_date: promotedAt,
      previous_program_level: member.program_level ?? null,
      next_program_level: member.program_level ?? null,
      previous_belt_code: member.current_belt ?? null,
      next_belt_code: newBelt,
      previous_stripes: currentStripes,
      next_stripes: 0,
      notes: eventNote,
      created_by: me.id,
    })
    if (progress.error) {
      redirect(buildHref({ q, member: memberUserId, error: 'save_failed' }))
    }
  } else {
    redirect(buildHref({ q, member: memberUserId, error: 'save_failed' }))
  }

  revalidatePath('/head-coach/promotion-desk')
  revalidatePath('/head-coach/athletes')
  revalidatePath(`/members/${memberUserId}`)
  redirect(buildHref({ saved: memberUserId }))
}

export default async function PromotionDeskPage({
  searchParams,
}: {
  searchParams?: SearchParams
}) {
  const me = await getSessionUserCached()
  const signedInAs = me?.full_name || me?.email || null

  if (!me || (me.role !== 'head_coach' && me.role !== 'super_admin')) {
    return (
      <AccessDeniedPage
        title="Promotion Desk"
        subtitle="Access restricted."
        signedInAs={signedInAs}
        message="Only the Head Coach and Super Admin can apply belt or stripe promotions."
        allowed="Allowed roles: Head Coach, Super Admin"
        nextPath="/head-coach/promotion-desk"
      />
    )
  }

  const q = pick(searchParams?.q).trim()
  const selectedMemberId = pick(searchParams?.member).trim()
  const savedMemberId = pick(searchParams?.saved).trim()
  const error = pick(searchParams?.error).trim()
  const admin = getSupabaseAdminClientCached()

  const rosterRes = await admin
    .from('head_coach_athlete_roster')
    .select('*')
    .order('first_name', { ascending: true })
    .order('last_name', { ascending: true })
    .limit(5000)
    .returns<BeltPromotionRosterRow[]>()

  if (rosterRes.error) throw new Error(rosterRes.error.message)

  const roster = (rosterRes.data ?? []).filter(
    (row) => !!row.role && BELT_PROMOTION_TARGET_ROLES.includes(row.role),
  )
  const selectedMember = roster.find((row) => row.user_id === selectedMemberId) ?? null
  const savedMember = roster.find((row) => row.user_id === savedMemberId) ?? null
  const results = q.length >= 2 ? roster.filter((row) => memberMatches(row, q)).slice(0, 20) : []
  const today = cairoToday()

  const beltTargets = selectedMember ? allowedBeltTargets(selectedMember) : []
  const currentStripes = selectedMember ? normalizeStripes(selectedMember.stripes) : 0
  const stripeTargets = [1, 2, 3, 4].filter((stripe) => stripe > currentStripes)

  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      <section className="rounded-3xl border border-black/10 bg-gradient-to-br from-white to-black/[0.02] p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-black px-3 py-1 text-xs font-semibold text-white">
                Promotion Day
              </span>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                Direct profile update
              </span>
            </div>
            <h1 className="mt-3 text-2xl font-bold sm:text-3xl">Belt Promotion Desk</h1>
            <p className="mt-2 max-w-3xl text-sm text-[hsl(var(--muted))] sm:text-base">
              Find a member, award a stripe or a new belt, set the effective date, and save it directly to the athlete profile and progression history.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/head-coach/belt-promotions" className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]">
              Full event workflow
            </Link>
            {me.role === 'super_admin' ? (
              <Link href="/admin" className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]">
                Admin
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      {savedMember ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <div className="font-semibold">Promotion saved for {fullName(savedMember.first_name, savedMember.last_name, savedMember.email)}.</div>
          <div className="mt-1 text-xs">The athlete profile and progression history have been updated. Search for the next member below.</div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <span className="font-semibold">Could not save:</span> {errorLabel(error)}
        </div>
      ) : null}

      <section className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
        <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm font-medium">
            Search member
            <input
              name="q"
              defaultValue={q}
              autoFocus
              placeholder="Name, Member ID or email"
              className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm"
            />
          </label>
          <button type="submit" className="rounded-xl bg-black px-5 py-2.5 text-sm font-semibold text-white">
            Search
          </button>
        </form>
        <div className="mt-2 text-xs text-[hsl(var(--muted))]">Enter at least 2 characters.</div>
      </section>

      {q.length >= 2 ? (
        <section className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">Search results</h2>
            <span className="text-xs text-[hsl(var(--muted))]">{results.length} shown</span>
          </div>
          <div className="mt-4 grid gap-2">
            {results.length ? results.map((row) => {
              const name = fullName(row.first_name, row.last_name, row.email)
              return (
                <Link
                  key={row.user_id}
                  href={buildHref({ q, member: row.user_id })}
                  className="flex flex-col gap-2 rounded-2xl border border-black/10 p-3 transition hover:bg-black/[0.025] sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="font-semibold">{name}</div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">
                      {row.member_id || 'No Member ID'} · {row.email || 'No email'}
                    </div>
                  </div>
                  <div className="text-sm font-semibold">
                    {row.current_belt ? titleCase(row.current_belt) : 'No belt'} · {normalizeStripes(row.stripes)} stripe{normalizeStripes(row.stripes) === 1 ? '' : 's'}
                  </div>
                </Link>
              )
            }) : (
              <div className="rounded-2xl border border-dashed border-black/10 p-5 text-center text-sm text-[hsl(var(--muted))]">No matching member found.</div>
            )}
          </div>
        </section>
      ) : null}

      {selectedMember ? (
        <section className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Selected member</div>
              <h2 className="mt-1 text-2xl font-bold">{fullName(selectedMember.first_name, selectedMember.last_name, selectedMember.email)}</h2>
              <div className="mt-1 text-sm text-[hsl(var(--muted))]">{selectedMember.member_id || 'No Member ID'} · {titleCase(selectedMember.program_level ?? 'program pending')}</div>
            </div>
            <Link href={`/members/${selectedMember.user_id}`} className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]">Open profile</Link>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-black/[0.025] p-4">
              <div className="text-xs text-[hsl(var(--muted))]">Current belt</div>
              <div className="mt-1 text-lg font-bold">{selectedMember.current_belt ? titleCase(selectedMember.current_belt) : 'Not recorded'}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">{selectedMember.current_belt_promoted_at ? `Since ${fmtDate(selectedMember.current_belt_promoted_at)}` : 'No promotion date recorded'}</div>
            </div>
            <div className="rounded-2xl bg-black/[0.025] p-4">
              <div className="text-xs text-[hsl(var(--muted))]">Current stripes</div>
              <div className="mt-1 text-lg font-bold">{currentStripes}</div>
            </div>
            <div className="rounded-2xl bg-black/[0.025] p-4">
              <div className="text-xs text-[hsl(var(--muted))]">Belt track</div>
              <div className="mt-1 text-lg font-bold">{titleCase(ageGroupFromDate(selectedMember.date_of_birth))}</div>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <form action={applyPromotionAction} className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
              <input type="hidden" name="promotion_type" value="stripe" />
              <input type="hidden" name="member_user_id" value={selectedMember.user_id} />
              <input type="hidden" name="q" value={q} />
              <div className="text-xs font-semibold uppercase tracking-wide text-violet-800">Stripe promotion</div>
              <h3 className="mt-1 text-lg font-bold text-violet-950">Award new stripe level</h3>

              {stripeTargets.length ? (
                <>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-medium text-violet-950">
                      New stripes
                      <select name="new_stripes" defaultValue={String(stripeTargets[0])} className="mt-1 w-full rounded-xl border border-violet-200 bg-white px-3 py-2.5 text-sm">
                        {stripeTargets.map((stripe) => <option key={stripe} value={stripe}>{stripe} stripe{stripe === 1 ? '' : 's'}</option>)}
                      </select>
                    </label>
                    <label className="text-sm font-medium text-violet-950">
                      Promotion date
                      <input type="date" name="promoted_at" max={today} defaultValue={today} required className="mt-1 w-full rounded-xl border border-violet-200 bg-white px-3 py-2.5 text-sm" />
                    </label>
                  </div>
                  <label className="mt-3 block text-sm font-medium text-violet-950">
                    Note <span className="font-normal text-violet-700">(optional)</span>
                    <input name="note" maxLength={1000} placeholder="Promotion ceremony, coach note…" className="mt-1 w-full rounded-xl border border-violet-200 bg-white px-3 py-2.5 text-sm" />
                  </label>
                  <button type="submit" className="mt-4 w-full rounded-xl bg-violet-800 px-4 py-2.5 text-sm font-bold text-white">Save stripe promotion</button>
                </>
              ) : (
                <div className="mt-4 rounded-xl bg-white/70 p-3 text-sm text-violet-900">This member already has 4 stripes. Use belt promotion when appropriate.</div>
              )}
            </form>

            <form action={applyPromotionAction} className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <input type="hidden" name="promotion_type" value="belt" />
              <input type="hidden" name="member_user_id" value={selectedMember.user_id} />
              <input type="hidden" name="q" value={q} />
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Belt promotion</div>
              <h3 className="mt-1 text-lg font-bold text-emerald-950">Award new belt</h3>

              {beltTargets.length ? (
                <>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-medium text-emerald-950">
                      New belt
                      <select name="new_belt" defaultValue={beltTargets[0]} className="mt-1 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5 text-sm">
                        {beltTargets.map((belt) => <option key={belt} value={belt}>{titleCase(belt)}</option>)}
                      </select>
                    </label>
                    <label className="text-sm font-medium text-emerald-950">
                      Promotion date
                      <input type="date" name="promoted_at" max={today} defaultValue={today} required className="mt-1 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5 text-sm" />
                    </label>
                  </div>
                  <label className="mt-3 block text-sm font-medium text-emerald-950">
                    Note <span className="font-normal text-emerald-700">(optional)</span>
                    <input name="note" maxLength={1000} placeholder="Promotion ceremony, coach note…" className="mt-1 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5 text-sm" />
                  </label>
                  <div className="mt-3 rounded-xl bg-white/70 p-3 text-xs text-emerald-900">A belt promotion automatically resets stripes to 0.</div>
                  <button type="submit" className="mt-4 w-full rounded-xl bg-emerald-800 px-4 py-2.5 text-sm font-bold text-white">Save belt promotion</button>
                </>
              ) : (
                <div className="mt-4 rounded-xl bg-white/70 p-3 text-sm text-emerald-900">No higher belt is available in this member’s current age track.</div>
              )}
            </form>
          </div>
        </section>
      ) : null}
    </main>
  )
}
