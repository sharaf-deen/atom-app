// src/app/scan/result/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
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
  // dateOnly expected: YYYY-MM-DD
  const [y, m, d] = dateOnly.split('-').map(Number)
  if (!y || !m || !d) return dateOnly
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
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

  const memberId = isUuid(searchParams.memberId) ? (searchParams.memberId as string) : null

  // Optional: load member identity + photo for visual verification at the entrance.
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

      memberName = ([p?.first_name ?? '', p?.last_name ?? ''].join(' ').trim() || '')
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

  // Frozen page (priority)
  if (frozen) {
    return (
      <main className="p-6 flex justify-center">
        <ResultSound kind={soundKind} />
        <Card className="w-full max-w-xl">
          <CardContent>
            <div className="text-center">
              <div className="text-7xl font-extrabold text-red-600">✕</div>
              <h1 className="mt-3 text-2xl font-semibold">Subscription frozen</h1>
              <p className="mt-2 text-[hsl(var(--muted))]">
                This membership is temporarily frozen.
              </p>

              {(memberName || memberCode || signedPhoto) ? (
                <div className="mt-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 flex items-center gap-3 text-left">
                  {signedPhoto ? (
                    <div className="relative h-14 w-14 overflow-hidden rounded-full border bg-white">
                      <Image src={signedPhoto} alt="Member photo" fill className="object-cover" />
                    </div>
                  ) : (
                    <div className="h-14 w-14 rounded-full border bg-white" />
                  )}
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{memberName || 'Member'}</div>
                    {memberCode ? <div className="text-xs text-[hsl(var(--muted))] truncate">ID: {memberCode}</div> : null}
                  </div>
                </div>
              ) : null}

              <div className="mt-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 text-left">
                {typeof freezeDaysRemaining === 'number' ? (
                  <p className="text-sm">
                    <span className="font-medium">Days remaining:</span> {freezeDaysRemaining}
                  </p>
                ) : null}
                {frozenUntil ? (
                  <p className="text-sm mt-1">
                    <span className="font-medium">Frozen until:</span> {fmtDateNice(frozenUntil)}
                  </p>
                ) : null}
              </div>

              <div className="mt-6 flex flex-col items-center gap-2">
                <AutoReturn seconds={3} href="/scan" />
                <Link href="/scan">
                  <Button>Scan again now</Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    )
  }

  // Active
  if (valid) {
    return (
      <main className="p-6 flex justify-center">
        <ResultSound kind={soundKind} />
        <Card className="w-full max-w-xl">
          <CardContent>
            <div className="text-center">
              <div className="text-7xl font-extrabold text-green-600">✓</div>
              <h1 className="mt-3 text-2xl font-semibold">Welcome back!</h1>
              <p className="mt-2 text-[hsl(var(--muted))]">
                Membership is active.
              </p>

              {(memberName || memberCode || signedPhoto) ? (
                <div className="mt-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 flex items-center gap-3 text-left">
                  {signedPhoto ? (
                    <div className="relative h-14 w-14 overflow-hidden rounded-full border bg-white">
                      <Image src={signedPhoto} alt="Member photo" fill className="object-cover" />
                    </div>
                  ) : (
                    <div className="h-14 w-14 rounded-full border bg-white" />
                  )}
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{memberName || 'Member'}</div>
                    {memberCode ? <div className="text-xs text-[hsl(var(--muted))] truncate">ID: {memberCode}</div> : null}
                  </div>
                </div>
              ) : null}

              <div className="mt-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 text-left">
                {typeof daysRemaining === 'number' ? (
                  <p className="text-sm">
                    <span className="font-medium">Days remaining:</span> {daysRemaining}
                  </p>
                ) : null}
                {expiresOn ? (
                  <p className="text-sm mt-1">
                    <span className="font-medium">Expires on:</span> {fmtDateNice(expiresOn)}
                  </p>
                ) : null}
              </div>

              <div className="mt-6 flex flex-col items-center gap-2">
                <AutoReturn seconds={3} href="/scan" />
                <Link href="/scan">
                  <Button>Scan again now</Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    )
  }

  // Expired
  return (
    <main className="p-6 flex justify-center">
      <ResultSound kind={soundKind} />
      <Card className="w-full max-w-xl">
        <CardContent>
          <div className="text-center">
            <div className="text-7xl font-extrabold text-red-600">✕</div>
            <h1 className="mt-3 text-2xl font-semibold">Membership expired</h1>
            <p className="mt-2 text-[hsl(var(--muted))]">
              Please renew your subscription.
            </p>

            {(memberName || memberCode || signedPhoto) ? (
              <div className="mt-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 flex items-center gap-3 text-left">
                {signedPhoto ? (
                  <div className="relative h-14 w-14 overflow-hidden rounded-full border bg-white">
                    <Image src={signedPhoto} alt="Member photo" fill className="object-cover" />
                  </div>
                ) : (
                  <div className="h-14 w-14 rounded-full border bg-white" />
                )}
                <div className="min-w-0">
                  <div className="font-semibold truncate">{memberName || 'Member'}</div>
                  {memberCode ? <div className="text-xs text-[hsl(var(--muted))] truncate">ID: {memberCode}</div> : null}
                </div>
              </div>
            ) : null}

            <div className="mt-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 text-left">
              {typeof expiredDays === 'number' ? (
                <p className="text-sm">
                  <span className="font-medium">Expired since:</span> {expiredDays} day(s)
                </p>
              ) : null}
              {expiredOn ? (
                <p className="text-sm mt-1">
                  <span className="font-medium">Expired on:</span> {fmtDateNice(expiredOn)}
                </p>
              ) : null}
            </div>

            <div className="mt-6 flex flex-col items-center gap-2">
              <AutoReturn seconds={3} href="/scan" />
              <Link href="/scan">
                <Button>Scan again now</Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
