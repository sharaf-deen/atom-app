// src/app/scan/result/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

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
import type { Role } from '@/lib/session'
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

function canAccess(role: Role) {
  return role === 'reception' || role === 'admin' || role === 'super_admin'
}

function isUuid(v?: string | null) {
  return !!v && /^[0-9a-f-]{36}$/i.test(v)
}

function parseIntSafe(v?: string): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function fmtDateNice(dateOnly?: string | null) {
  if (!dateOnly) return ''
  const [y, m, d] = dateOnly.split('-').map(Number)
  if (!y || !m || !d) return dateOnly
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
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

function StatusBadge({
  tone,
  children,
}: {
  tone: 'success' | 'warning' | 'danger'
  children: React.ReactNode
}) {
  const cls =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : tone === 'warning'
        ? 'border-sky-200 bg-sky-50 text-sky-700'
        : 'border-rose-200 bg-rose-50 text-rose-700'

  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${cls}`}>{children}</span>
}

function FactCard({
  label,
  value,
  icon,
}: {
  label: string
  value: React.ReactNode
  icon: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted))]">{label}</div>
          <div className="mt-2 text-base font-semibold tracking-tight">{value}</div>
        </div>
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white text-black">
          {icon}
        </span>
      </div>
    </div>
  )
}

function InfoStrip({
  title,
  body,
  tone,
}: {
  title: string
  body: string
  tone: 'success' | 'warning' | 'danger'
}) {
  const cls =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : tone === 'warning'
        ? 'border-sky-200 bg-sky-50 text-sky-800'
        : 'border-rose-200 bg-rose-50 text-rose-800'

  return (
    <div className={`rounded-2xl border px-4 py-3 ${cls}`}>
      <div className="text-sm font-semibold tracking-tight">{title}</div>
      <p className="mt-1 text-sm">{body}</p>
    </div>
  )
}

export default async function ScanResultPage({ searchParams }: { searchParams: SearchParams }) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/scan')

  if (!canAccess(me.role)) {
    return (
      <AccessDeniedPage
        title="Scan — Check-in & Validity"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="Only Reception / Admin / Super Admin can access scan results."
        allowed="reception, admin, super_admin"
        nextPath="/scan"
        actions={[{ href: '/members', label: 'Go to Members' }]}
        showBackHome
      />
    )
  }

  const frozen = searchParams.frozen === '1'
  const valid = searchParams.valid === '1'
  const kioskMode = searchParams.kiosk === '1'
  const returnHref = kioskMode ? '/scan?kiosk=1' : '/scan'
  const apiMessage = safeMessage(searchParams.message)

  const memberId = isUuid(searchParams.memberId) ? (searchParams.memberId as string) : null

  let memberName = ''
  let memberCode = ''
  let signedPhoto = ''
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
    } catch {
      // ignore
    }
  }

  const repeatScan = searchParams.repeat === '1'
  const repeatSeconds = parseIntSafe(searchParams.repeatSeconds)

  let attendanceTodayScannedAt: string | null = null
  let attendanceTodayStatus: string | null = null
  let recentValidAttendanceCount = 0
  let validAttendance7dCount = 0
  let lastAttendanceDate: string | null = null
  let lastValidAttendanceAt: string | null = null
  let lastValidAttendanceDate: string | null = null

  if (memberId) {
    try {
      const admin = getSupabaseAdminClientCached()
      const today = todayDateOnlyCairo()
      const since30 = dateDaysAgoCairo(30)
      const since7 = dateDaysAgoCairo(7)
      const { data: attendanceRows } = await admin
        .from('attendance')
        .select('date, valid, status, scanned_at')
        .eq('member_id', memberId)
.gte('date', since30)
        .order('date', { ascending: false })
        .order('scanned_at', { ascending: false })
        .limit(40)

      const rows = (attendanceRows ?? []) as Array<{
        date: string
        valid: boolean | null
        status: string | null
        scanned_at: string | null
      }>

      const todayRow = rows.find((row) => row.date === today) ?? null
      attendanceTodayScannedAt = todayRow?.scanned_at ?? null
      attendanceTodayStatus = todayRow?.status ?? null
      const validRows = rows.filter((row) => !!row.valid)
      recentValidAttendanceCount = validRows.length
      validAttendance7dCount = validRows.filter((row) => row.date >= since7).length
      lastAttendanceDate = rows[0]?.date ?? null
      lastValidAttendanceAt = validRows[0]?.scanned_at ?? null
      lastValidAttendanceDate = validRows[0]?.date ?? null
    } catch {
      // ignore
    }
  }

  const daysRemaining = parseIntSafe(searchParams.daysRemaining)
  const expiresOn = searchParams.expiresOn || null
  const expiredDays = parseIntSafe(searchParams.expiredDays)
  const expiredOn = searchParams.expiredOn || null
  const frozenUntil = searchParams.frozenUntil || null
  const freezeDaysRemaining = parseIntSafe(searchParams.freezeDaysRemaining)

  const soundKind = frozen ? 'frozen' : valid ? 'ok' : 'invalid'
  const alreadyCheckedToday = apiMessage.toLowerCase().includes('already checked') || repeatScan
  const alreadyHereToday = !!attendanceTodayScannedAt && alreadyCheckedToday
  const recentActive = recentValidAttendanceCount > 0
  const presenceTitle = alreadyHereToday
    ? 'Member already here today'
    : attendanceTodayScannedAt && valid
      ? 'First valid entry recorded today'
      : recentActive
        ? 'Recent member activity found'
        : 'No recent valid attendance found'

  const presenceBody = alreadyHereToday
    ? "Attendance is already in today's log. Let the member continue unless the desk needs to open the profile."
    : attendanceTodayScannedAt && valid
      ? "Attendance is already in today's log. Let the member continue unless the desk needs to open the profile."
      : recentActive
        ? `Last valid attendance: ${lastValidAttendanceAt ? fmtDateTimeNice(lastValidAttendanceAt) : lastValidAttendanceDate ? fmtDateNice(lastValidAttendanceDate) : 'recently active'}.`
        : 'No valid attendance was found in the recent period. Use the member profile if the desk needs more history.'

  const presenceBadgeLabel = alreadyHereToday
    ? 'Already here today'
    : attendanceTodayScannedAt && valid
      ? 'Recorded today'
      : recentActive
        ? 'Recent activity'
        : 'No recent activity'

  const presenceTone: 'success' | 'warning' | 'danger' = alreadyHereToday
    ? 'warning'
    : attendanceTodayScannedAt && valid
      ? 'success'
      : recentActive
        ? 'success'
        : 'danger'


  const tone: 'success' | 'warning' | 'danger' = frozen ? 'warning' : valid ? 'success' : 'danger'
  const heroIcon = frozen ? (
    <Snowflake size={30} strokeWidth={2.1} />
  ) : valid ? (
    <ShieldCheck size={30} strokeWidth={2.1} />
  ) : (
    <ShieldAlert size={30} strokeWidth={2.1} />
  )

  const title = frozen ? 'Subscription frozen' : valid ? 'Check-in allowed' : 'Check-in blocked'
  const subtitle = frozen
    ? 'This membership is temporarily frozen.'
    : valid
      ? 'Membership is valid for check-in.'
      : 'Membership is not currently valid for check-in.'
  const statusLabel = repeatScan ? (valid ? 'Already today' : 'Repeat scan') : frozen ? 'Frozen' : valid ? 'Valid' : 'Expired'

  const nextStepTitle = frozen
    ? 'Next step: open the member profile and review the freeze period.'
    : valid
      ? alreadyCheckedToday
        ? 'Next step: no extra attendance action is needed.'
        : 'Next step: let the member in and continue to the next scan.'
      : 'Next step: open the member profile and renew or settle the membership.'

  const nextStepBody = frozen
    ? 'Do not allow check-in until the freeze ends or the membership is updated.'
    : valid
      ? alreadyCheckedToday
        ? 'Attendance is already recorded for today. You can continue scanning unless the desk needs the member profile.'
        : 'This result was recorded. You can continue scanning immediately.'
      : 'Use the member profile to renew, settle dues or explain why check-in is blocked.'

  const primaryHref = !valid && memberId ? `/members/${memberId}` : returnHref
  const primaryLabel = !valid && memberId ? 'Open member' : 'Scan next'
  const primaryIcon = !valid && memberId ? <QrCode size={16} className="mr-2" /> : <ScanLine size={16} className="mr-2" />

  const infoTitle = repeatScan
    ? 'Repeated scan detected'
    : valid
      ? alreadyCheckedToday
        ? 'Already recorded today'
        : 'Check-in recorded'
      : frozen
        ? 'Check-in blocked by freeze'
        : 'Check-in blocked by membership status'

  const infoBody = repeatScan
    ? `Same QR scanned again${typeof repeatSeconds === 'number' ? ` after ${repeatSeconds}s` : ''}. Showing the latest known result for this member.`
    : apiMessage || subtitle

  return (
    <main className="min-h-[calc(100vh-3rem)] bg-[hsl(var(--bg))] p-4 sm:p-6">
      <ResultSound kind={soundKind} />

      <div className="mx-auto max-w-4xl space-y-4">
        <Card className="rounded-3xl border border-[hsl(var(--border))]">
          <CardContent>
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={tone}>{statusLabel}</StatusBadge>
                    {kioskMode ? <StatusBadge tone="warning">Auto-return enabled</StatusBadge> : null}
                    {alreadyCheckedToday ? <StatusBadge tone="success">Already today</StatusBadge> : null}
                    <StatusBadge tone={presenceTone}>{presenceBadgeLabel}</StatusBadge>
                    {repeatScan ? <StatusBadge tone={valid ? 'success' : 'warning'}>Repeat scan</StatusBadge> : null}
                    {attendanceTodayScannedAt ? <StatusBadge tone={valid ? 'success' : 'warning'}>Attendance today</StatusBadge> : null}
                  </div>
                  <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
                  <p className="mt-2 max-w-2xl text-sm text-[hsl(var(--muted))] sm:text-base">{subtitle}</p>
                </div>

                <div
                  className={
                    'inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl border ' +
                    (tone === 'success'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : tone === 'warning'
                        ? 'border-sky-200 bg-sky-50 text-sky-700'
                        : 'border-rose-200 bg-rose-50 text-rose-700')
                  }
                >
                  {heroIcon}
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
                {(memberName || memberCode || signedPhoto) ? (
                  <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                    <div className="flex items-center gap-3">
                      {signedPhoto ? (
                        <div className="relative h-16 w-16 overflow-hidden rounded-full border bg-white">
                          <Image src={signedPhoto} alt="Member photo" fill className="object-cover" />
                        </div>
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-full border bg-white text-[hsl(var(--muted))]">
                          <UserRound size={22} />
                        </div>
                      )}

                      <div className="min-w-0">
                        <div className="text-base font-semibold tracking-tight">{memberName || 'Member'}</div>
                        {memberCode ? <div className="mt-1 text-sm text-[hsl(var(--muted))]">ID: {memberCode}</div> : null}
                        <div className="mt-2 text-sm text-[hsl(var(--muted))]">Presence context below helps the desk understand whether the member is already here today or recently active.</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                    <div className="text-base font-semibold tracking-tight">Member profile not loaded</div>
                    <p className="mt-2 text-sm text-[hsl(var(--muted))]">The scan result is still valid, but no member details were loaded on this screen.</p>
                  </div>
                )}

                <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-black">
                      {valid ? <CircleCheckBig size={18} strokeWidth={2.1} /> : <CircleAlert size={18} strokeWidth={2.1} />}
                    </span>
                    <div>
                      <div className="text-sm font-semibold tracking-tight">{nextStepTitle}</div>
                      <p className="mt-1 text-sm text-[hsl(var(--muted))]">{nextStepBody}</p>
                    </div>
                  </div>
                </div>
              </div>

              <InfoStrip title={infoTitle} body={infoBody} tone={tone} />

              <InfoStrip title={presenceTitle} body={presenceBody} tone={presenceTone} />

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <FactCard
                  label="Presence now"
                  value={presenceBadgeLabel}
                  icon={<UserRound size={18} strokeWidth={2.1} />}
                />
                <FactCard
                  label="Last valid check-in"
                  value={lastValidAttendanceAt ? fmtDateTimeNice(lastValidAttendanceAt) : lastValidAttendanceDate ? fmtDateNice(lastValidAttendanceDate) : '—'}
                  icon={<Clock3 size={18} strokeWidth={2.1} />}
                />
                <FactCard
                  label="Valid attendance · 7d"
                  value={validAttendance7dCount > 0 ? validAttendance7dCount : '0'}
                  icon={<CalendarDays size={18} strokeWidth={2.1} />}
                />
                <FactCard
                  label="Valid attendance · 30d"
                  value={recentValidAttendanceCount > 0 ? recentValidAttendanceCount : '0'}
                  icon={<CircleCheckBig size={18} strokeWidth={2.1} />}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <FactCard
                  label="Today attendance"
                  value={attendanceTodayScannedAt ? 'Recorded' : 'Not recorded'}
                  icon={<CircleCheckBig size={18} strokeWidth={2.1} />}
                />
                <FactCard
                  label="Checked at"
                  value={attendanceTodayScannedAt ? fmtDateTimeNice(attendanceTodayScannedAt) : '—'}
                  icon={<Clock3 size={18} strokeWidth={2.1} />}
                />
                <FactCard
                  label="Latest attendance date"
                  value={lastAttendanceDate ? fmtDateNice(lastAttendanceDate) : '—'}
                  icon={<CalendarDays size={18} strokeWidth={2.1} />}
                />
              </div>

              {attendanceTodayStatus ? (
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm text-[hsl(var(--muted))]">
                  Today status: <span className="font-semibold text-black">{attendanceTodayStatus}</span>
                  {lastAttendanceDate ? <span className="ml-2">• Latest attendance date: {fmtDateNice(lastAttendanceDate)}</span> : null}
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {frozen ? (
                  <>
                    <FactCard
                      label="Frozen until"
                      value={frozenUntil ? fmtDateNice(frozenUntil) : '—'}
                      icon={<CalendarDays size={18} strokeWidth={2.1} />}
                    />
                    <FactCard
                      label="Days remaining"
                      value={typeof freezeDaysRemaining === 'number' ? freezeDaysRemaining : '—'}
                      icon={<Snowflake size={18} strokeWidth={2.1} />}
                    />
                    <FactCard label="Result" value="Check-in blocked" icon={<ShieldAlert size={18} strokeWidth={2.1} />} />
                  </>
                ) : valid ? (
                  <>
                    <FactCard
                      label="Days remaining"
                      value={typeof daysRemaining === 'number' ? daysRemaining : apiMessage || '—'}
                      icon={<CalendarDays size={18} strokeWidth={2.1} />}
                    />
                    <FactCard
                      label="Expires on"
                      value={expiresOn ? fmtDateNice(expiresOn) : 'Sessions membership'}
                      icon={<ShieldCheck size={18} strokeWidth={2.1} />}
                    />
                    <FactCard label="Result" value="Check-in allowed" icon={<CircleCheckBig size={18} strokeWidth={2.1} />} />
                  </>
                ) : (
                  <>
                    <FactCard
                      label="Expired since"
                      value={typeof expiredDays === 'number' ? `${expiredDays} day(s)` : '—'}
                      icon={<Clock3 size={18} strokeWidth={2.1} />}
                    />
                    <FactCard
                      label="Expired on"
                      value={expiredOn ? fmtDateNice(expiredOn) : '—'}
                      icon={<ShieldAlert size={18} strokeWidth={2.1} />}
                    />
                    <FactCard label="Result" value="Check-in blocked" icon={<CircleAlert size={18} strokeWidth={2.1} />} />
                  </>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Link href={primaryHref}>
                  <Button className="w-full">
                    {primaryIcon}
                    {primaryLabel}
                  </Button>
                </Link>

                {memberId ? (
                  <Link href={`/members/${memberId}`}>
                    <Button variant="outline" className="w-full">
                      <QrCode size={16} className="mr-2" />
                      Open member
                    </Button>
                  </Link>
                ) : null}

                <Link href="/members">
                  <Button variant="outline" className="w-full">
                    <UserRound size={16} className="mr-2" />
                    Members
                  </Button>
                </Link>

                <Link href="/scan">
                  <Button variant="outline" className="w-full">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to scanner
                  </Button>
                </Link>
              </div>

              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm text-[hsl(var(--muted))]">
                <AutoReturn seconds={7} href={returnHref} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
