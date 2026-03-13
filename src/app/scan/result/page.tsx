// src/app/scan/result/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  ArrowLeft,
  CalendarDays,
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

  const daysRemaining = parseIntSafe(searchParams.daysRemaining)
  const expiresOn = searchParams.expiresOn || null
  const expiredDays = parseIntSafe(searchParams.expiredDays)
  const expiredOn = searchParams.expiredOn || null
  const frozenUntil = searchParams.frozenUntil || null
  const freezeDaysRemaining = parseIntSafe(searchParams.freezeDaysRemaining)

  const soundKind = frozen ? 'frozen' : valid ? 'ok' : 'invalid'

  const tone: 'success' | 'warning' | 'danger' = frozen ? 'warning' : valid ? 'success' : 'danger'
  const icon = frozen ? (
    <Snowflake size={30} strokeWidth={2.1} />
  ) : valid ? (
    <ShieldCheck size={30} strokeWidth={2.1} />
  ) : (
    <ShieldAlert size={30} strokeWidth={2.1} />
  )

  const title = frozen ? 'Subscription frozen' : valid ? 'Welcome back!' : 'Membership expired'
  const subtitle = frozen
    ? 'This membership is temporarily frozen.'
    : valid
      ? 'Membership is active.'
      : 'Please renew the subscription before check-in.'
  const statusLabel = frozen ? 'Frozen' : valid ? 'Valid' : 'Expired'

  return (
    <main className="min-h-[calc(100vh-3rem)] bg-[hsl(var(--bg))] p-4 sm:p-6">
      <ResultSound kind={soundKind} />

      <div className="mx-auto max-w-3xl space-y-4">
        <Card className="rounded-3xl border border-[hsl(var(--border))]">
          <CardContent>
            <div className="flex flex-col gap-5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={tone}>{statusLabel}</StatusBadge>
                    {kioskMode ? <StatusBadge tone="warning">Kiosk return</StatusBadge> : null}
                  </div>
                  <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
                  <p className="mt-2 text-sm text-[hsl(var(--muted))] sm:text-base">{subtitle}</p>
                </div>

                <div
                  className={
                    'inline-flex h-16 w-16 items-center justify-center rounded-3xl border ' +
                    (tone === 'success'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : tone === 'warning'
                        ? 'border-sky-200 bg-sky-50 text-sky-700'
                        : 'border-rose-200 bg-rose-50 text-rose-700')
                  }
                >
                  {icon}
                </div>
              </div>

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
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
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
                  </>
                ) : valid ? (
                  <>
                    <FactCard
                      label="Days remaining"
                      value={typeof daysRemaining === 'number' ? daysRemaining : '—'}
                      icon={<CalendarDays size={18} strokeWidth={2.1} />}
                    />
                    <FactCard
                      label="Expires on"
                      value={expiresOn ? fmtDateNice(expiresOn) : '—'}
                      icon={<ShieldCheck size={18} strokeWidth={2.1} />}
                    />
                  </>
                ) : (
                  <>
                    <FactCard
                      label="Expired since"
                      value={typeof expiredDays === 'number' ? `${expiredDays} day(s)` : '—'}
                      icon={<CalendarDays size={18} strokeWidth={2.1} />}
                    />
                    <FactCard
                      label="Expired on"
                      value={expiredOn ? fmtDateNice(expiredOn) : '—'}
                      icon={<ShieldAlert size={18} strokeWidth={2.1} />}
                    />
                  </>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Link href={returnHref}>
                  <Button className="w-full">
                    <ScanLine size={16} className="mr-2" />
                    Scan again
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