// src/app/scan/result/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import type { Role } from '@/lib/session'

import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import { Card, CardContent } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import AccessDeniedPage from '@/components/AccessDeniedPage'

import AutoReturn from './AutoReturn'

function canAccess(role: Role) {
  return role === 'reception' || role === 'admin' || role === 'super_admin'
}

function pick(searchParams: Record<string, string | string[] | undefined>, key: string): string | null {
  const v = searchParams[key]
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

function parseIntOrNull(v: string | null): number | null {
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function formatDateOnly(dateOnly: string): string {
  // YYYY-MM-DD -> human date (UTC)
  const m = String(dateOnly).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return dateOnly
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'short', day: '2-digit' }).format(d)
}

export default async function ScanResultPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const user = await getSessionUser()
  if (!user) redirect('/login?next=/scan')

  if (!canAccess(user.role)) {
    return (
      <AccessDeniedPage
        title="Scan — Check-in result"
        subtitle="Access restricted."
        signedInAs={user.email}
        message="Only Reception / Admin / Super Admin can view scan results."
        allowed="reception, admin, super_admin"
        nextPath="/scan"
        actions={[{ href: '/members', label: 'Go to Members' }]}
        showBackHome
      />
    )
  }

  const validRaw = pick(searchParams, 'valid')
  if (!validRaw) redirect('/scan')
  const valid = validRaw === '1'
  const daysRemaining = parseIntOrNull(pick(searchParams, 'daysRemaining'))
  const expiresOn = pick(searchParams, 'expiresOn')

  const expiredDays = parseIntOrNull(pick(searchParams, 'expiredDays'))
  const expiredOn = pick(searchParams, 'expiredOn')

  const title = valid ? 'Access granted' : 'Subscription expired'
  const subtitle = valid
    ? 'Subscription is active.'
    : 'No active subscription was found for today.'

  const circleClass = valid
    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
    : 'border-rose-300 bg-rose-50 text-rose-700'

  let message = ''
  if (valid) {
    if (daysRemaining === 0) {
      message = 'Congratulations! Your subscription is active — today is the last day. Enjoy training.'
    } else if (typeof daysRemaining === 'number' && daysRemaining > 0) {
      message = `Congratulations! Your subscription is active — ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining.`
    } else {
      message = 'Congratulations! Your subscription is active. Enjoy training.'
    }
    if (expiresOn) {
      message += ` (Ends on ${formatDateOnly(expiresOn)}.)`
    }
  } else {
    if (typeof expiredDays === 'number' && expiredDays > 0) {
      message = `Your subscription expired ${expiredDays} day${expiredDays === 1 ? '' : 's'} ago.`
      if (expiredOn) message += ` (Expired on ${formatDateOnly(expiredOn)}.)`
    } else if (expiredOn) {
      message = `Your subscription is not active. It ended on ${formatDateOnly(expiredOn)}.`
    } else {
      message = 'Your subscription is not active. Please renew to access the academy.'
    }
  }

  return (
    <main>
      <PageHeader title={title} subtitle={subtitle} showReload={false} />

      <Section className="max-w-3xl">
        <Card>
          <CardContent className="flex flex-col items-center text-center gap-4 py-10">
            <div
              className={
                `h-32 w-32 rounded-full border flex items-center justify-center text-7xl font-extrabold ${circleClass}`
              }
              aria-hidden
            >
              {valid ? 'V' : 'X'}
            </div>

            <h2 className="text-2xl font-semibold">{valid ? 'Welcome!' : 'Renewal needed'}</h2>
            <p className="text-[hsl(var(--muted))] max-w-xl">{message}</p>

            <div className="mt-2">
              <Button asChild href="/scan" size="lg">
                Back to scanner
              </Button>
            </div>

            <AutoReturn seconds={10} href="/scan" />
          </CardContent>
        </Card>
      </Section>
    </main>
  )
}
