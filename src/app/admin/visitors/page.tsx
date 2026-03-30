export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Textarea from '@/components/ui/Textarea'
import InlineAlert from '@/components/ui/InlineAlert'
import { cairoTodayDateOnly, formatDateTimeInCairo } from '@/lib/cairoTime'
import { isISODateOnly, normalizeEmail, sanitizePhone, sanitizeSearch, sanitizeText } from '@/lib/inputGuard'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import { canAccessVisitorTrials } from '@/lib/rbac'

type TrialSource = 'walk_in' | 'instagram' | 'website' | 'referral' | 'whatsapp' | 'other'
type TrialStoredStatus = 'new' | 'booked' | 'attended' | 'followed_up' | 'closed'
type TrialComputedState = TrialStoredStatus | 'follow_up_due' | 'linked_member' | 'converted'
type TrialStateFilter = 'all' | TrialComputedState

type VisitorTrialRow = {
  id: string
  first_name: string
  last_name: string | null
  phone: string | null
  email: string | null
  source_key: TrialSource
  status: TrialStoredStatus
  trial_date: string
  trial_attended_at: string | null
  free_trial_used: boolean
  follow_up_due_at: string | null
  follow_up_sent_at: string | null
  notes: string | null
  linked_member_id: string | null
  created_at: string
  created_by: string | null
  updated_at: string
  updated_by: string | null
}

type LinkedProfileMini = {
  user_id: string
  member_id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
}

type EnrichedTrial = VisitorTrialRow & {
  computed_state: TrialComputedState
  linked_profile: LinkedProfileMini | null
  has_subscription: boolean
}

const SOURCE_OPTIONS: Array<{ value: TrialSource; label: string }> = [
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'website', label: 'Website' },
  { value: 'referral', label: 'Referral' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'other', label: 'Other' },
]

const STATE_OPTIONS: Array<{ value: TrialStateFilter; label: string }> = [
  { value: 'all', label: 'All states' },
  { value: 'booked', label: 'Booked' },
  { value: 'attended', label: 'Attended' },
  { value: 'follow_up_due', label: 'Follow-up due' },
  { value: 'followed_up', label: 'Followed up' },
  { value: 'linked_member', label: 'Member linked' },
  { value: 'converted', label: 'Converted' },
  { value: 'closed', label: 'Closed' },
]

function safeStr(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function parseSourceFilter(value: unknown): TrialSource | 'all' {
  return SOURCE_OPTIONS.some((item) => item.value === value) ? (value as TrialSource) : 'all'
}

function parseStateFilter(value: unknown): TrialStateFilter {
  return STATE_OPTIONS.some((item) => item.value === value) ? (value as TrialStateFilter) : 'all'
}

function buildQueryString(params: Record<string, string | null | undefined>) {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    const next = String(value ?? '').trim()
    if (next) sp.set(key, next)
  }
  return sp.toString()
}

function withFlash(returnQS: string, params: Record<string, string | null | undefined>) {
  const sp = new URLSearchParams(returnQS)
  for (const [key, value] of Object.entries(params)) {
    const next = String(value ?? '').trim()
    if (next) sp.set(key, next)
  }
  const qs = sp.toString()
  return `/admin/visitors${qs ? `?${qs}` : ''}`
}

function sourceLabel(source: TrialSource) {
  return SOURCE_OPTIONS.find((item) => item.value === source)?.label ?? source
}

function sourceBadgeClass(source: TrialSource) {
  switch (source) {
    case 'walk_in':
      return 'border-slate-200 bg-slate-50 text-slate-700'
    case 'instagram':
      return 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800'
    case 'website':
      return 'border-sky-200 bg-sky-50 text-sky-800'
    case 'referral':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800'
    case 'whatsapp':
      return 'border-green-200 bg-green-50 text-green-800'
    default:
      return 'border-amber-200 bg-amber-50 text-amber-900'
  }
}

function statusLabel(state: TrialComputedState) {
  switch (state) {
    case 'new':
      return 'New'
    case 'booked':
      return 'Booked'
    case 'attended':
      return 'Attended'
    case 'follow_up_due':
      return 'Follow-up due'
    case 'followed_up':
      return 'Followed up'
    case 'linked_member':
      return 'Member linked'
    case 'converted':
      return 'Converted'
    case 'closed':
      return 'Closed'
    default:
      return state
  }
}

function statusBadgeClass(state: TrialComputedState) {
  switch (state) {
    case 'booked':
      return 'border-sky-200 bg-sky-50 text-sky-800'
    case 'attended':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800'
    case 'follow_up_due':
      return 'border-amber-200 bg-amber-50 text-amber-900'
    case 'followed_up':
      return 'border-indigo-200 bg-indigo-50 text-indigo-800'
    case 'linked_member':
      return 'border-violet-200 bg-violet-50 text-violet-800'
    case 'converted':
      return 'border-green-200 bg-green-50 text-green-800'
    case 'closed':
      return 'border-slate-200 bg-slate-50 text-slate-600'
    default:
      return 'border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-[hsl(var(--muted))]'
  }
}

function displayName(row: Pick<VisitorTrialRow, 'first_name' | 'last_name'>) {
  return `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || 'Unknown visitor'
}

function linkedProfileName(profile?: LinkedProfileMini | null) {
  if (!profile) return 'Linked member'
  const full = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim()
  return full || profile.email || profile.member_id || 'Linked member'
}

function normalizePhoneForLookup(phone?: string | null) {
  return sanitizePhone(phone ?? '').trim()
}

function toWhatsAppDigits(phone?: string | null) {
  const digits = String(phone ?? '').replace(/\D+/g, '')
  return digits.length >= 7 ? digits : ''
}

function buildCreateMemberHref(row: VisitorTrialRow) {
  const qs = buildQueryString({
    visitor_trial_id: row.id,
    first_name: row.first_name,
    last_name: row.last_name ?? '',
    email: row.email ?? '',
    phone: row.phone ?? '',
  })

  return `/kiosk${qs ? `?${qs}` : ''}`
}

function computeState(row: VisitorTrialRow, args: { hasSubscription: boolean; nowMs: number }): TrialComputedState {
  if (args.hasSubscription) return 'converted'
  if (row.status === 'closed') return 'closed'
  if (row.status === 'followed_up') return 'followed_up'

  const dueAt = row.follow_up_due_at ? new Date(row.follow_up_due_at).getTime() : NaN
  if (row.free_trial_used && Number.isFinite(dueAt) && dueAt <= args.nowMs) return 'follow_up_due'
  if (row.linked_member_id) return 'linked_member'
  if (row.free_trial_used || row.status === 'attended' || !!row.trial_attended_at) return 'attended'
  if (row.status === 'new') return 'new'
  return 'booked'
}

async function addVisitorAction(formData: FormData) {
  'use server'

  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/visitors')
  if (!canAccessVisitorTrials(me.role)) redirect('/admin/visitors?error=Access%20denied')

  const returnQS = safeStr(formData.get('return_qs'))
  const first_name = sanitizeText(formData.get('first_name'), { max: 80 })
  const last_name = sanitizeText(formData.get('last_name'), { max: 80 })
  const phone = sanitizePhone(formData.get('phone'), 32)
  const email = normalizeEmail(formData.get('email'))
  const source_key = parseSourceFilter(formData.get('source_key'))
  const trial_date = safeStr(formData.get('trial_date')).trim() || cairoTodayDateOnly()
  const notes = sanitizeText(formData.get('notes'), { max: 1000, allowNewlines: true })

  if (!first_name) redirect(withFlash(returnQS, { error: 'First name is required.' }))
  if (!phone && !email) redirect(withFlash(returnQS, { error: 'Phone or email is required.' }))
  if (email && !/^\S+@\S+\.\S+$/.test(email)) redirect(withFlash(returnQS, { error: 'Email is invalid.' }))
  if (!isISODateOnly(trial_date)) redirect(withFlash(returnQS, { error: 'Trial date is invalid.' }))
  if (source_key === 'all') redirect(withFlash(returnQS, { error: 'Source is invalid.' }))

  const admin = getSupabaseAdminClientCached()

  if (email) {
    const { data: existingEmail, error: emailError } = await admin
      .from('visitor_trials')
      .select('id')
      .ilike('email', email)
      .limit(1)

    if (emailError) redirect(withFlash(returnQS, { error: emailError.message || 'Could not validate email.' }))
    if ((existingEmail ?? []).length > 0) {
      redirect(withFlash(returnQS, { error: 'A visitor trial already exists for this email.' }))
    }
  }

  if (phone) {
    let phoneQuery = admin
      .from('visitor_trials')
      .select('id,last_name')
      .eq('first_name', first_name)
      .eq('phone', phone)
      .limit(20)

    const { data: existingPhone, error: phoneError } = await phoneQuery

    if (phoneError) redirect(withFlash(returnQS, { error: phoneError.message || 'Could not validate phone.' }))
    const duplicatePhone = (existingPhone ?? []).some((row: any) => String(row?.last_name ?? '').trim().toLowerCase() === last_name.toLowerCase())
    if (duplicatePhone) {
      redirect(withFlash(returnQS, { error: 'This visitor already used the free trial flow.' }))
    }
  }

  const { error } = await admin.from('visitor_trials').insert({
    first_name,
    last_name: last_name || null,
    phone: phone || null,
    email: email || null,
    source_key,
    status: 'booked',
    trial_date,
    notes: notes || null,
    created_by: me.id,
    updated_by: me.id,
  })

  if (error) redirect(withFlash(returnQS, { error: error.message || 'Could not create visitor.' }))
  redirect(withFlash(returnQS, { created: '1' }))
}

async function markAttendedAction(formData: FormData) {
  'use server'

  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/visitors')
  if (!canAccessVisitorTrials(me.role)) redirect('/admin/visitors?error=Access%20denied')

  const returnQS = safeStr(formData.get('return_qs'))
  const id = sanitizeText(formData.get('id'), { max: 80 })
  if (!id) redirect(withFlash(returnQS, { error: 'Missing visitor id.' }))

  const now = new Date()
  const due = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const admin = getSupabaseAdminClientCached()
  const { error } = await admin
    .from('visitor_trials')
    .update({
      status: 'attended',
      trial_attended_at: now.toISOString(),
      free_trial_used: true,
      follow_up_due_at: due.toISOString(),
      updated_by: me.id,
    })
    .eq('id', id)

  if (error) redirect(withFlash(returnQS, { error: error.message || 'Could not mark attended.' }))
  redirect(withFlash(returnQS, { attended: '1' }))
}

async function markFollowedUpAction(formData: FormData) {
  'use server'

  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/visitors')
  if (!canAccessVisitorTrials(me.role)) redirect('/admin/visitors?error=Access%20denied')

  const returnQS = safeStr(formData.get('return_qs'))
  const id = sanitizeText(formData.get('id'), { max: 80 })
  if (!id) redirect(withFlash(returnQS, { error: 'Missing visitor id.' }))

  const admin = getSupabaseAdminClientCached()
  const { error } = await admin
    .from('visitor_trials')
    .update({
      status: 'followed_up',
      follow_up_sent_at: new Date().toISOString(),
      updated_by: me.id,
    })
    .eq('id', id)

  if (error) redirect(withFlash(returnQS, { error: error.message || 'Could not save follow-up.' }))
  redirect(withFlash(returnQS, { followed_up: '1' }))
}

async function closeVisitorAction(formData: FormData) {
  'use server'

  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/visitors')
  if (!canAccessVisitorTrials(me.role)) redirect('/admin/visitors?error=Access%20denied')

  const returnQS = safeStr(formData.get('return_qs'))
  const id = sanitizeText(formData.get('id'), { max: 80 })
  if (!id) redirect(withFlash(returnQS, { error: 'Missing visitor id.' }))

  const admin = getSupabaseAdminClientCached()
  const { error } = await admin
    .from('visitor_trials')
    .update({
      status: 'closed',
      updated_by: me.id,
    })
    .eq('id', id)

  if (error) redirect(withFlash(returnQS, { error: error.message || 'Could not close visitor.' }))
  redirect(withFlash(returnQS, { closed: '1' }))
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent>
        <div className="text-sm text-[hsl(var(--muted))]">{label}</div>
        <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
        <div className="mt-1 text-xs text-[hsl(var(--muted))]">{hint}</div>
      </CardContent>
    </Card>
  )
}

function FlashBanner({
  created,
  attended,
  followedUp,
  closed,
  error,
}: {
  created: boolean
  attended: boolean
  followedUp: boolean
  closed: boolean
  error: string
}) {
  if (error) return <InlineAlert variant="error">{error}</InlineAlert>
  if (created) return <InlineAlert variant="success">Visitor trial created.</InlineAlert>
  if (attended) return <InlineAlert variant="success">Visitor marked as attended. Follow-up is due in 7 days if no subscription is created.</InlineAlert>
  if (followedUp) return <InlineAlert variant="success">Follow-up saved.</InlineAlert>
  if (closed) return <InlineAlert variant="success">Visitor trial closed.</InlineAlert>
  return null
}

export default async function VisitorTrialsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/visitors')

  if (!canAccessVisitorTrials(me.role)) {
    return (
      <AccessDeniedPage
        title="Visitors"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Reception / Admin / Super Admin can access visitor trials."
        allowed="reception, admin, super_admin"
        nextPath="/admin/visitors"
        actions={[{ href: '/reception', label: 'Go to Front desk' }]}
        showBackHome
      />
    )
  }

  const q = sanitizeSearch(typeof searchParams?.q === 'string' ? searchParams.q : '', { max: 80 })
  const source = parseSourceFilter(typeof searchParams?.source === 'string' ? searchParams.source : 'all')
  const state = parseStateFilter(typeof searchParams?.state === 'string' ? searchParams.state : 'all')
  const flashError = safeStr(searchParams?.error).trim()
  const flashCreated = safeStr(searchParams?.created).trim() === '1'
  const flashAttended = safeStr(searchParams?.attended).trim() === '1'
  const flashFollowedUp = safeStr(searchParams?.followed_up).trim() === '1'
  const flashClosed = safeStr(searchParams?.closed).trim() === '1'

  const returnQS = buildQueryString({
    q: q || undefined,
    source: source !== 'all' ? source : undefined,
    state: state !== 'all' ? state : undefined,
  })

  const admin = getSupabaseAdminClientCached()

  let query = admin
    .from('visitor_trials')
    .select('id,first_name,last_name,phone,email,source_key,status,trial_date,trial_attended_at,free_trial_used,follow_up_due_at,follow_up_sent_at,notes,linked_member_id,created_at,created_by,updated_at,updated_by')
    .order('created_at', { ascending: false })
    .limit(200)

  if (source !== 'all') query = query.eq('source_key', source)
  if (q) {
    const pattern = `%${q}%`
    query = query.or(`first_name.ilike.${pattern},last_name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern},notes.ilike.${pattern}`)
  }

  const { data, error } = await query

  if (error) {
    return (
      <main>
        <PageHeader title="Visitors" subtitle="Free trial pipeline and follow-up." />
        <Section>
          <InlineAlert variant="error">{error.message || 'Could not load visitor trials.'}</InlineAlert>
        </Section>
      </main>
    )
  }

  const rows = ((data ?? []) as VisitorTrialRow[])
  const linkedIds = Array.from(new Set(rows.map((row) => row.linked_member_id).filter((value): value is string => !!value)))

  let linkedProfiles = new Map<string, LinkedProfileMini>()
  let subscriptionsByMember = new Map<string, number>()

  if (linkedIds.length) {
    const [{ data: profileRows }, { data: subscriptionRows }] = await Promise.all([
      admin
        .from('profiles')
        .select('user_id,member_id,first_name,last_name,email')
        .in('user_id', linkedIds),
      admin
        .from('subscriptions')
        .select('member_id')
        .in('member_id', linkedIds)
        .limit(10000),
    ])

    linkedProfiles = new Map(
      ((profileRows ?? []) as LinkedProfileMini[]).map((profile) => [profile.user_id, profile])
    )

    subscriptionsByMember = (subscriptionRows ?? []).reduce((acc, row: any) => {
      const memberId = safeStr(row?.member_id).trim()
      if (!memberId) return acc
      acc.set(memberId, (acc.get(memberId) ?? 0) + 1)
      return acc
    }, new Map<string, number>())
  }

  const nowMs = Date.now()
  const enriched: EnrichedTrial[] = rows.map((row) => {
    const has_subscription = !!row.linked_member_id && (subscriptionsByMember.get(row.linked_member_id) ?? 0) > 0
    return {
      ...row,
      has_subscription,
      linked_profile: row.linked_member_id ? linkedProfiles.get(row.linked_member_id) ?? null : null,
      computed_state: computeState(row, { hasSubscription: has_subscription, nowMs }),
    }
  })

  const summary = {
    total: enriched.length,
    booked: enriched.filter((row) => row.computed_state === 'booked').length,
    attended: enriched.filter((row) => row.computed_state === 'attended').length,
    follow_up_due: enriched.filter((row) => row.computed_state === 'follow_up_due').length,
    converted: enriched.filter((row) => row.computed_state === 'converted').length,
  }

  const visibleRows = state === 'all' ? enriched : enriched.filter((row) => row.computed_state === state)
  const today = cairoTodayDateOnly()

  return (
    <main>
      <PageHeader
        title="Visitors"
        subtitle="Free trial leads, 1-session rule, and J+7 follow-up."
        right={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" href="/reception">
              Front desk
            </Button>
            <Button asChild variant="outline" href="/kiosk">
              Create member
            </Button>
          </div>
        }
      />

      <Section className="space-y-4">
        <FlashBanner
          created={flashCreated}
          attended={flashAttended}
          followedUp={flashFollowedUp}
          closed={flashClosed}
          error={flashError}
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <SummaryCard label="Visitors" value={String(summary.total)} hint="Latest 200 rows after current search/source filter." />
          <SummaryCard label="Booked" value={String(summary.booked)} hint="Trial planned but not yet attended." />
          <SummaryCard label="Attended" value={String(summary.attended)} hint="Free trial used. Waiting for follow-up window." />
          <SummaryCard label="Follow-up due" value={String(summary.follow_up_due)} hint="J+7 reached and still no subscription." />
          <SummaryCard label="Converted" value={String(summary.converted)} hint="Linked member with at least one subscription." />
        </div>
      </Section>

      <Section className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>New visitor trial</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={addVisitorAction} className="grid gap-3">
              <input type="hidden" name="return_qs" value={returnQS} />
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <Input name="first_name" label="First name *" placeholder="Ahmed" required />
                <Input name="last_name" label="Last name" placeholder="Mohamed" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <Input name="phone" label="Phone" placeholder="+201…" />
                <Input name="email" label="Email" type="email" placeholder="name@example.com" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <Input name="trial_date" type="date" label="Trial date" defaultValue={today} required />
                <Select name="source_key" label="Source" defaultValue="walk_in">
                  {SOURCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Select>
              </div>
              <Textarea
                name="notes"
                label="Notes"
                rows={4}
                placeholder="Goal, age, schedule preference, who referred them, etc."
              />
              <InlineAlert variant="info" compact>
                One free trial only. The visitor is linked to a member later from the kiosk flow, and follow-up becomes due 7 days after attendance if no subscription exists.
              </InlineAlert>
              <div className="flex flex-wrap gap-2">
                <Button type="submit">Save visitor</Button>
                <Button asChild variant="outline" href="/kiosk">
                  Open kiosk
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent>
              <form method="get" action="/admin/visitors" className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px_auto]">
                <Input name="q" label="Search" defaultValue={q} placeholder="Name, phone, email or notes" />
                <Select name="source" label="Source" defaultValue={source}>
                  <option value="all">All sources</option>
                  {SOURCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Select>
                <Select name="state" label="State" defaultValue={state}>
                  {STATE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Select>
                <div className="flex items-end gap-2">
                  <Button type="submit" variant="outline">Apply</Button>
                  <Button asChild variant="ghost" href="/admin/visitors">
                    Reset
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <div className="space-y-3">
            {visibleRows.length === 0 ? (
              <Card>
                <CardContent>
                  <div className="text-sm text-[hsl(var(--muted))]">No visitor trials match the current filters.</div>
                </CardContent>
              </Card>
            ) : null}

            {visibleRows.map((row) => {
              const whatsapp = toWhatsAppDigits(row.phone)
              const linkedHref = row.linked_member_id ? `/members/${row.linked_member_id}` : ''
              const canMarkAttended = !row.free_trial_used && row.computed_state !== 'closed' && row.computed_state !== 'converted'
              const canFollowUp = row.computed_state === 'follow_up_due'
              const canClose = row.computed_state !== 'closed' && row.computed_state !== 'converted'
              const phoneForLookup = normalizePhoneForLookup(row.phone)

              return (
                <Card key={row.id}>
                  <CardContent>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-lg font-semibold tracking-tight">{displayName(row)}</div>
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(row.computed_state)}`}>
                            {statusLabel(row.computed_state)}
                          </span>
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${sourceBadgeClass(row.source_key)}`}>
                            {sourceLabel(row.source_key)}
                          </span>
                        </div>

                        <div className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
                          <div>
                            <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Contact</div>
                            <div className="mt-1 space-y-1 break-words">
                              <div>{row.phone || '—'}</div>
                              <div>{row.email || '—'}</div>
                            </div>
                          </div>

                          <div>
                            <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Trial</div>
                            <div className="mt-1 space-y-1">
                              <div>Date: <span className="font-medium">{row.trial_date || '—'}</span></div>
                              <div>Attended: <span className="font-medium">{row.trial_attended_at ? formatDateTimeInCairo(row.trial_attended_at) : '—'}</span></div>
                            </div>
                          </div>

                          <div>
                            <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">Follow-up</div>
                            <div className="mt-1 space-y-1">
                              <div>Due: <span className="font-medium">{row.follow_up_due_at ? formatDateTimeInCairo(row.follow_up_due_at) : '—'}</span></div>
                              <div>Sent: <span className="font-medium">{row.follow_up_sent_at ? formatDateTimeInCairo(row.follow_up_sent_at) : '—'}</span></div>
                            </div>
                          </div>
                        </div>

                        {row.notes ? (
                          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-2 text-sm text-[hsl(var(--muted))] whitespace-pre-wrap break-words">
                            {row.notes}
                          </div>
                        ) : null}

                        {row.linked_member_id ? (
                          <div className="rounded-2xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
                            <div className="font-medium">Linked member</div>
                            <div className="mt-1 break-words">
                              {linkedProfileName(row.linked_profile)}
                              {row.linked_profile?.member_id ? ` · ${row.linked_profile.member_id}` : ''}
                              {row.has_subscription ? ' · subscription found' : ' · no subscription yet'}
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="flex w-full shrink-0 flex-col gap-2 lg:w-[250px]">
                        {!row.linked_member_id ? (
                          <Button asChild href={buildCreateMemberHref(row)}>
                            Convert in kiosk
                          </Button>
                        ) : linkedHref ? (
                          <Button asChild href={linkedHref}>
                            Open member
                          </Button>
                        ) : null}

                        {whatsapp ? (
                          <Button asChild variant="outline" href={`https://wa.me/${whatsapp}`}>
                            WhatsApp
                          </Button>
                        ) : null}

                        {row.phone ? (
                          <Button asChild variant="outline" href={`tel:${row.phone}`}>
                            Call
                          </Button>
                        ) : null}

                        {canMarkAttended ? (
                          <form action={markAttendedAction}>
                            <input type="hidden" name="return_qs" value={returnQS} />
                            <input type="hidden" name="id" value={row.id} />
                            <Button type="submit" variant="outline" className="w-full">
                              Mark attended
                            </Button>
                          </form>
                        ) : null}

                        {canFollowUp ? (
                          <form action={markFollowedUpAction}>
                            <input type="hidden" name="return_qs" value={returnQS} />
                            <input type="hidden" name="id" value={row.id} />
                            <Button type="submit" variant="outline" className="w-full">
                              Follow-up sent
                            </Button>
                          </form>
                        ) : null}

                        {canClose ? (
                          <form action={closeVisitorAction}>
                            <input type="hidden" name="return_qs" value={returnQS} />
                            <input type="hidden" name="id" value={row.id} />
                            <Button type="submit" variant="ghost" className="w-full">
                              Close
                            </Button>
                          </form>
                        ) : null}

                        {phoneForLookup ? (
                          <Link
                            href={`/members?q=${encodeURIComponent(phoneForLookup)}`}
                            className="text-center text-xs text-[hsl(var(--muted))] underline underline-offset-4 hover:text-black"
                          >
                            Search existing members by phone
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      </Section>
    </main>
  )
}
