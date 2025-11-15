// app/scan/page.tsx
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import KioskScanner from '@/components/KioskScanner'
import type { Role } from '@/lib/session'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'

function canAccess(role: Role) {
  return role === 'reception' || role === 'admin' || role === 'super_admin'
}

export default async function ScanPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (!canAccess(user.role)) redirect('/')

  return (
    <main>
      <PageHeader
        title="Scan — Check-in & Validity"
        subtitle="Scan member QR to record attendance and verify subscription validity."
      />

      <Section className="max-w-3xl">
        {/* Version réduite : 280px de large, ratio carré */}
        <KioskScanner size="sm" ratio="1:1" />
        <p className="mt-3 text-sm text-[hsl(var(--muted))]">
          Aim the QR code within the frame. The system will validate the member’s current subscription and
          save attendance automatically.
        </p>
      </Section>
    </main>
  )
}
