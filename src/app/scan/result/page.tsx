export const dynamic = 'force-dynamic'
export const revalidate = 0

import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  ArrowLeft,
  CalendarDays,
  CircleAlert,
  CircleCheckBig,
  Clock3,
  QrCode,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  Snowflake,
  UserRound,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import { canAccessScan } from '@/lib/rbac'
import AccountActivationBadge from '@/components/account/AccountActivationBadge'
import { accountActivationDescription, accountActivationTone, type AccountActivationStatus } from '@/lib/accountActivation'
import { getAccountActivationForMemberUserId } from '@/lib/accountActivationServer'
import AutoReturn from './AutoReturn'
import ResultSound from './ResultSound'

type SearchParams = {
  valid?: string
  frozen?: string
  memberId?: string
  daysRemaining?: string
  expiresOn?: string
  expiredDays?: string
  expiredOn?: string
  frozenUntil?: string
  freezeDaysRemaining?: string
  kiosk?: string
  message?: string
  repeat?: string
  repeatSeconds?: string
}

type SubRow = {
  id: string
  plan: '1m' | '3m' | '6m' | '12m' | 'sessions' | null
  subscription_type: 'time' | 'sessions' | null
  status: string | null
  start_date: string | null
  end_date: string | null
  sessions_total: number | null
  sessions_used: number | null
  paid_at: string | null
  frozen_from: string | null
  frozen_until: string | null
}

type SubscriptionSummary = {
  stateLabel: string
  stateTone: 'success' | 'warning' | 'danger'
  startDate: string | null
  endDate: string | null
  durationLabel: string
  detailLabel: string
}

function accountStatusInfoTone(status: AccountActivationStatus): 'success' | 'warning' | 'danger' {
  const tone = accountActivationTone(status)
  if (tone === 'success') return 'success'
  if (tone === 'danger') return 'danger'
  return 'warning'
}

function isUuid(v?: string | null) {
  return !!v && /^[0-9a-f-]{36}$/i.test(v)
}

function parseIntSafe(v?: string) {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function fmtDateNice(dateOnly?: string | null) {
  if (!dateOnly) return '—'
  const [y, m, d] = dateOnly.split('-').map(Number)
  if (!y || !m || !d) return dateOnly
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
}

function fmtDateTimeNice(v?: string | null) {
  if (!v) return '—'
  const dt = new Date(v)
  if (Number.isNaN(dt.getTime())) return v
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dt)
}

function safeMessage(v?: string) {
  return (v || '').trim().slice(0, 180)
}

const CAIRO_TZ = 'Africa/Cairo'

function todayDateOnlyCairo() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const m = parts.find((p) => p.type === 'month')?.value ?? '01'
  const d = parts.find((p) => p.type === 'day')?.value ?? '01'
  return `${y}-${m}-${d}`
}

function dateDaysAgoCairo(days: number) {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(now.getTime() - days * 86400000))
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const m = parts.find((p) => p.type === 'month')?.value ?? '01'
  const d = parts.find((p) => p.type === 'day')?.value ?? '01'
  return `${y}-${m}-${d}`
}

function humanPlan(plan?: SubRow['plan']) {
  switch (plan) {
    case '1m':
      return '1 month'
    case '3m':
      return '3 months'
    case '6m':
      return '6 months'
    case '12m':
      return '12 months'
    case 'sessions':
      return 'Sessions package'
    default:
      return 'Membership'
  }
}

function isFrozenNow(sub: Pick<SubRow, 'subscription_type' | 'frozen_from' | 'frozen_until'>, today: string) {
  const st = (sub.subscription_type ?? 'time') as 'time' | 'sessions'
  if (st !== 'time') return false
  const until = sub.frozen_until
  if (!until) return false
  const from = sub.frozen_from
  return from ? today >= from && today < until : today < until
}

function buildSubscriptionSummary(
  subs: SubRow[],
  today: string,
  opts: {
    valid: boolean
    frozen: boolean
    apiMessage: string
    expiresOn: string | null
    expiredOn: string | null
    frozenUntil: string | null
    daysRemaining: number | null
    expiredDays: number | null
    freezeDaysRemaining: number | null
  }
): SubscriptionSummary {
  const activeTime = subs.find((s) => {
    if (s.status !== 'active') return false
    if ((s.subscription_type ?? 'time') !== 'time') return false
    if (!s.end_date || s.end_date < today) return false
    return true
  })

  if (activeTime) {
    const frozenNow = isFrozenNow(activeTime, today) || opts.frozen
    if (frozenNow) {
      return {
        stateLabel: 'FROZEN',
        stateTone: 'warning',
        startDate: activeTime.start_date ?? null,
        endDate: activeTime.end_date ?? opts.frozenUntil ?? null,
        durationLabel: humanPlan(activeTime.plan),
        detailLabel:
          typeof opts.freezeDaysRemaining === 'number'
            ? `${opts.freezeDaysRemaining} day(s) left in freeze`
            : opts.apiMessage || 'Membership temporarily frozen',
      }
    }

    return {
      stateLabel: opts.valid ? 'ACTIVE' : 'EXPIRED',
      stateTone: opts.valid ? 'success' : 'danger',
      startDate: activeTime.start_date ?? null,
      endDate: activeTime.end_date ?? opts.expiresOn ?? null,
      durationLabel: humanPlan(activeTime.plan),
      detailLabel:
        typeof opts.daysRemaining === 'number'
          ? `${opts.daysRemaining} day(s) remaining`
          : opts.apiMessage || 'Active membership',
    }
  }

  const activeSessions = subs.find((s) => {
    if (s.status !== 'active') return false
    if ((s.subscription_type ?? (s.plan === 'sessions' ? 'sessions' : 'time')) !== 'sessions') return false
    const remaining = Math.max(Number(s.sessions_total ?? 0) - Number(s.sessions_used ?? 0), 0)
    return remaining > 0
  })

  if (activeSessions) {
    const remaining = Math.max(Number(activeSessions.sessions_total ?? 0) - Number(activeSessions.sessions_used ?? 0), 0)
    const total = Math.max(Number(activeSessions.sessions_total ?? 0), 0)
    return {
      stateLabel: opts.valid ? 'ACTIVE' : 'EXPIRED',
      stateTone: opts.valid ? 'success' : 'danger',
      startDate: activeSessions.start_date ?? null,
      endDate: activeSessions.end_date ?? null,
      durationLabel: humanPlan(activeSessions.plan),
      detailLabel: total > 0 ? `${remaining}/${total} session(s) left` : opts.apiMessage || 'Sessions membership',
    }
  }

  const latest = subs[0] ?? null
  return {
    stateLabel: opts.frozen ? 'FROZEN' : opts.valid ? 'ACTIVE' : 'EXPIRED',
    stateTone: opts.frozen ? 'warning' : opts.valid ? 'success' : 'danger',
    startDate: latest?.start_date ?? null,
    endDate: latest?.end_date ?? opts.expiresOn ?? opts.expiredOn ?? opts.frozenUntil ?? null,
    durationLabel: humanPlan(latest?.plan),
    detailLabel:
      opts.frozen
        ? opts.apiMessage || 'Membership frozen'
        : opts.valid
          ? opts.apiMessage || 'Active membership'
          : typeof opts.expiredDays === 'number'
            ? `${opts.expiredDays} day(s) expired`
            : opts.apiMessage || 'No active membership',
  }
}

function StatusHero({ label, tone }: { label: string; tone: 'success' | 'warning' | 'danger' }) {
  const cls =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : tone === 'warning'
        ? 'border-sky-200 bg-sky-50 text-sky-700'
        : 'border-rose-200 bg-rose-50 text-rose-700'

  return (
    <div className={`inline-flex min-h-[112px] min-w-[180px] items-center justify-center rounded-3xl border px-6 py-5 text-center ${cls}`}>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] opacity-70">Membership</div>
        <div className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{label}</div>
      </div>
    </div>
  )
}

function KeyFact({
  label,
  value,
  icon,
  emphasize = false,
}: {
  label: string
  value: ReactNode
  icon: ReactNode
  emphasize?: boolean
}) {
  return (
    <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-black">
          {icon}
        </span>
        <span>{label}</span>
      </div>
      <div className={`mt-3 ${emphasize ? 'text-2xl font-black tracking-tight' : 'text-base font-semibold tracking-tight'}`}>{value}</div>
    </div>
  )
}

function InlineInfo({
  tone,
  title,
  body,
}: {
  tone: 'success' | 'warning' | 'danger'
  title: string
  body: string
}) {
  const cls =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : tone === 'warning'
        ? 'border-sky-200 bg-sky-50 text-sky-800'
        : 'border-rose-200 bg-rose-50 text-rose-800'

  return (
    <div className={`rounded-3xl border px-4 py-4 ${cls}`}>
      <div className="text-sm font-semibold tracking-tight">{title}</div>
      <div className="mt-1 text-sm opacity-90">{body}</div>
    </div>
  )
}

export default async function ScanResultPage({ searchParams }: { searchParams: SearchParams }) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/scan')

  if (!canAccessScan(me.role)) {
    return (
      <AccessDeniedPage
        title="Scan — Check-in & Validity"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Reception / Scan Terminal / Admin / Super Admin can access scan results."
        allowed="reception, scan_terminal, admin, super_admin"
        nextPath="/scan"
        actions={[{ href: '/members', label: 'Go to Members' }]}
        showBackHome
      />
    )
  }

  const frozen = searchParams.frozen === '1'
  const valid = searchParams.valid === '1'
  const isTerminal = me.role === 'scan_terminal'
  const kioskMode = isTerminal || searchParams.kiosk === '1'
  const returnHref = '/scan'
  const apiMessage = safeMessage(searchParams.message)
  const memberId = isUuid(searchParams.memberId) ? (searchParams.memberId as string) : null

  const daysRemaining = parseIntSafe(searchParams.daysRemaining)
  const expiresOn = searchParams.expiresOn || null
  const expiredDays = parseIntSafe(searchParams.expiredDays)
  const expiredOn = searchParams.expiredOn || null
  const frozenUntil = searchParams.frozenUntil || null
  const freezeDaysRemaining = parseIntSafe(searchParams.freezeDaysRemaining)
  const repeatScan = searchParams.repeat === '1'
  const repeatSeconds = parseIntSafe(searchParams.repeatSeconds)

  let memberName = ''
  let memberCode = ''
  let signedPhoto = ''
  let subscriptions: SubRow[] = []
  let attendanceTodayScannedAt: string | null = null
  let accountStatus: AccountActivationStatus | null = null

  if (memberId) {
    try {
      const admin = getSupabaseAdminClientCached()
      const { data: p } = await admin
        .from('profiles')
        .select('first_name,last_name,member_id,id_photo_path')
        .eq('user_id', memberId)
        .maybeSingle<{ first_name: string | null; last_name: string | null; member_id: string | null; id_photo_path: string | null }>()

      memberName = [p?.first_name ?? '', p?.last_name ?? ''].join(' ').trim() || ''
      memberCode = p?.member_id ?? ''

      if (p?.id_photo_path) {
        const { data } = await admin.storage.from('id-photos').createSignedUrl(p.id_photo_path, 60 * 5)
        signedPhoto = data?.signedUrl || ''
      }

      const today = todayDateOnlyCairo()
      const since7 = dateDaysAgoCairo(7)

      const [{ data: subRows }, { data: attendanceRows }, activationStatus] = await Promise.all([
        admin
          .from('subscriptions')
          .select('id, plan, subscription_type, status, start_date, end_date, sessions_total, sessions_used, paid_at, frozen_from, frozen_until')
          .eq('member_id', memberId)
          .order('paid_at', { ascending: false, nullsFirst: false })
          .order('end_date', { ascending: false, nullsFirst: false })
          .limit(10),
        admin
          .from('attendance')
          .select('date, scanned_at')
          .eq('member_id', memberId)
          .gte('date', since7)
          .order('date', { ascending: false })
          .order('scanned_at', { ascending: false })
          .limit(10),
        getAccountActivationForMemberUserId(memberId),
      ])

      subscriptions = (subRows ?? []) as SubRow[]
      const todayRow = ((attendanceRows ?? []) as Array<{ date: string; scanned_at: string | null }>).find((row) => row.date === today) ?? null
      attendanceTodayScannedAt = todayRow?.scanned_at ?? null
      accountStatus = activationStatus
    } catch {
      // ignore
    }
  }

  const today = todayDateOnlyCairo()
  const summary = buildSubscriptionSummary(subscriptions, today, {
    valid,
    frozen,
    apiMessage,
    expiresOn,
    expiredOn,
    frozenUntil,
    daysRemaining,
    expiredDays,
    freezeDaysRemaining,
  })

  const tone = summary.stateTone
  const soundKind = frozen ? 'frozen' : valid ? 'ok' : 'invalid'
  const heroIcon = frozen ? (
    <Snowflake size={22} strokeWidth={2.1} />
  ) : valid ? (
    <ShieldCheck size={22} strokeWidth={2.1} />
  ) : (
    <ShieldAlert size={22} strokeWidth={2.1} />
  )

  const title = frozen ? 'Subscription frozen' : valid ? 'Membership active' : 'Membership expired'
  const subtitle = frozen
    ? 'Do not allow entry until the freeze ends or the membership is updated.'
    : valid
      ? 'Membership is valid. You can let the member in.'
      : 'Membership is not active. Send the member to reception.'

  const infoTitle = repeatScan
    ? 'Repeated scan'
    : valid
      ? attendanceTodayScannedAt
        ? 'Already scanned today'
        : 'Check-in recorded'
      : frozen
        ? 'Frozen membership'
        : 'Expired membership'

  const infoBody = repeatScan
    ? `Same QR scanned again${typeof repeatSeconds === 'number' ? ` after ${repeatSeconds}s` : ''}.`
    : attendanceTodayScannedAt && valid
      ? `Attendance already recorded today at ${fmtDateTimeNice(attendanceTodayScannedAt)}.`
      : apiMessage || subtitle

  const primaryHref = valid ? returnHref : memberId ? `/members/${memberId}` : '/members'
  const primaryLabel = valid ? 'Scan next' : memberId ? 'Open member' : 'Open members'
  const primaryIcon = valid ? <ScanLine size={16} className="mr-2" /> : <QrCode size={16} className="mr-2" />

  return (
    <main className="min-h-[calc(100vh-3rem)] bg-[hsl(var(--bg))] p-4 sm:p-6">
      <ResultSound kind={soundKind} />

      <div className="mx-auto max-w-5xl space-y-4">
        <Card className="rounded-3xl border border-[hsl(var(--border))]">
          <CardContent>
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 items-center gap-4">
                  {signedPhoto ? (
                    <div className="relative h-20 w-20 overflow-hidden rounded-full border bg-white sm:h-24 sm:w-24">
                      <Image src={signedPhoto} alt="Member photo" fill className="object-cover" />
                    </div>
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center rounded-full border bg-white text-[hsl(var(--muted))] sm:h-24 sm:w-24">
                      <UserRound size={28} />
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1 text-xs font-semibold text-[hsl(var(--muted))]">
                      {heroIcon}
                      Scan result
                    </div>
                    <h1 className="mt-3 text-2xl font-black tracking-tight sm:text-3xl">{memberName || 'Member'}</h1>
                    <div className="mt-2 flex flex-wrap gap-2 text-sm text-[hsl(var(--muted))]">
                      {memberCode ? <span>ID: {memberCode}</span> : null}
                      <span>•</span>
                      <span>{title}</span>
                    </div>
                    <p className="mt-3 max-w-2xl text-sm text-[hsl(var(--muted))] sm:text-base">{subtitle}</p>
                  </div>
                </div>

                <StatusHero label={summary.stateLabel} tone={tone} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <KeyFact label="Status" value={summary.stateLabel} icon={<ShieldCheck size={18} strokeWidth={2.1} />} emphasize />
                <KeyFact label="Start date" value={fmtDateNice(summary.startDate)} icon={<CalendarDays size={18} strokeWidth={2.1} />} />
                <KeyFact label="End date" value={fmtDateNice(summary.endDate)} icon={<CalendarDays size={18} strokeWidth={2.1} />} />
                <KeyFact label="Duration" value={summary.durationLabel} icon={<Clock3 size={18} strokeWidth={2.1} />} />
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
                <InlineInfo tone={tone} title={infoTitle} body={infoBody} />
                <KeyFact label="Subscription detail" value={summary.detailLabel} icon={<CircleCheckBig size={18} strokeWidth={2.1} />} />
              </div>

              {accountStatus ? (
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
                  <InlineInfo
                    tone={accountStatusInfoTone(accountStatus)}
                    title="App account status"
                    body={accountActivationDescription(accountStatus)}
                  />
                  <KeyFact
                    label="App account"
                    value={<AccountActivationBadge status={accountStatus} compact />}
                    icon={<UserRound size={18} strokeWidth={2.1} />}
                  />
                </div>
              ) : null}

              {isTerminal ? (
                <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
                  <div className="font-semibold">Door terminal mode</div>
                  <div className="mt-1">Front camera stays locked on the tablet. This screen returns automatically to scan after 7 seconds.</div>
                  <div className="mt-2 text-xs text-sky-700">Device label: scan-terminal-front</div>
                </div>
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row">
                {isTerminal ? (
                  <Link href={returnHref} className="sm:flex-1">
                    <Button className="w-full">
                      <ArrowLeft size={16} className="mr-2" />
                      Back to scan
                    </Button>
                  </Link>
                ) : (
                  <>
                    <Link href={primaryHref} className="sm:flex-1">
                      <Button className="w-full">
                        {primaryIcon}
                        {primaryLabel}
                      </Button>
                    </Link>

                    {memberId ? (
                      <Link href={`/members/${memberId}`} className="sm:flex-1">
                        <Button variant="outline" className="w-full">
                          <QrCode size={16} className="mr-2" />
                          Open profile
                        </Button>
                      </Link>
                    ) : null}

                    <Link href={returnHref} className="sm:flex-1">
                      <Button variant="outline" className="w-full">
                        <ArrowLeft size={16} className="mr-2" />
                        Back to scan
                      </Button>
                    </Link>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {kioskMode ? <AutoReturn href={returnHref} seconds={7} /> : null}
    </main>
  )
}
