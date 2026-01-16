// src/app/scan/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import type { Role } from '@/lib/session'
import KioskScanner from '@/components/KioskScanner'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'

function canAccess(role: Role) {
  return role === 'reception' || role === 'admin' || role === 'super_admin'
}

export default async function ScanPage() {
  const user = await getSessionUser()

  if (!user) {
    redirect('/login?next=/scan')
  }

  if (!canAccess(user.role)) {
    const logoutNext = '/scan'
    return (
      <main>
        <PageHeader title="Scan" subtitle="Access restricted" />

        <div className="p-6 max-w-2xl mx-auto">
          <div className="rounded-2xl border bg-white p-5 space-y-2">
            <div className="text-sm text-gray-600">
              You’re signed in as <span className="font-medium">{user.email}</span>.
            </div>

            <div className="text-base font-semibold">
              You don’t have permission to access the scanner.
            </div>

            <div className="text-sm text-gray-600">
              This page is limited to <span className="font-medium">Reception</span> and{' '}
              <span className="font-medium">Admins</span>.
            </div>

            <div className="flex gap-2 flex-wrap pt-2">
              <Link href="/" className="border rounded-lg px-4 py-2 text-sm hover:bg-gray-50">
                Back to home
              </Link>
              <Link href="/profile" className="border rounded-lg px-4 py-2 text-sm hover:bg-gray-50">
                My profile
              </Link>
              <Link
                href={`/logout?next=${encodeURIComponent(logoutNext)}`}
                className="border rounded-lg px-4 py-2 text-sm hover:bg-gray-50"
              >
                Switch account
              </Link>
            </div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main>
      <PageHeader
        title="Scan — Check-in & Validity"
        subtitle="Scan member QR to record attendance and verify subscription validity."
      />

      <Section className="max-w-3xl">
        <KioskScanner size="sm" ratio="1:1" />
        <p className="mt-3 text-sm text-[hsl(var(--muted))]">
          Aim the QR code within the frame. The system will validate the member’s current subscription and
          save attendance automatically.
        </p>
      </Section>
    </main>
  )
}
