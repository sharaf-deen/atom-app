// src/app/scan/result/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/Card'
import Button from '@/components/ui/Button'

type SearchParams = {
  valid?: string
  frozen?: string
  daysRemaining?: string
  expiresOn?: string
  expiredDays?: string
  expiredOn?: string
  frozenUntil?: string
  freezeDaysRemaining?: string
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

export default function ScanResultPage({ searchParams }: { searchParams: SearchParams }) {
  const frozen = searchParams.frozen === '1'
  const valid = searchParams.valid === '1'

  const daysRemaining = parseIntSafe(searchParams.daysRemaining)
  const expiresOn = searchParams.expiresOn || null

  const expiredDays = parseIntSafe(searchParams.expiredDays)
  const expiredOn = searchParams.expiredOn || null

  const frozenUntil = searchParams.frozenUntil || null
  const freezeDaysRemaining = parseIntSafe(searchParams.freezeDaysRemaining)

  // Frozen page (priority)
  if (frozen) {
    return (
      <main className="p-6 flex justify-center">
        <Card className="w-full max-w-xl">
          <CardContent>
            <div className="text-center">
              <div className="text-7xl font-extrabold text-red-600">✕</div>
              <h1 className="mt-3 text-2xl font-semibold">Subscription frozen</h1>
              <p className="mt-2 text-[hsl(var(--muted))]">
                This membership is temporarily frozen.
              </p>

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

              <div className="mt-6 flex justify-center">
                <Link href="/scan">
                  <Button>Back to scan</Button>
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
        <Card className="w-full max-w-xl">
          <CardContent>
            <div className="text-center">
              <div className="text-7xl font-extrabold text-green-600">✓</div>
              <h1 className="mt-3 text-2xl font-semibold">Welcome back!</h1>
              <p className="mt-2 text-[hsl(var(--muted))]">
                Membership is active.
              </p>

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

              <div className="mt-6 flex justify-center">
                <Link href="/scan">
                  <Button>Back to scan</Button>
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
      <Card className="w-full max-w-xl">
        <CardContent>
          <div className="text-center">
            <div className="text-7xl font-extrabold text-red-600">✕</div>
            <h1 className="mt-3 text-2xl font-semibold">Membership expired</h1>
            <p className="mt-2 text-[hsl(var(--muted))]">
              Please renew your subscription.
            </p>

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

            <div className="mt-6 flex justify-center">
              <Link href="/scan">
                <Button>Back to scan</Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
