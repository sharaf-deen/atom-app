// src/app/scan/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ClipboardList, ScanLine, UserPlus, Users } from 'lucide-react'
import { getSessionUser } from '@/lib/session'
import { canAccessScan } from '@/lib/rbac'
import KioskScanner from '@/components/KioskScanner'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import KioskHealthBadge from '@/components/KioskHealthBadge'

function QuickLink({
  href,
  label,
  desc,
  icon,
}: {
  href: string
  label: string
  desc: string
  icon: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-tight">{label}</div>
          <p className="mt-1 text-sm text-[hsl(var(--muted))]">{desc}</p>
        </div>
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] text-black">
          {icon}
        </span>
      </div>
    </Link>
  )
}

export default async function ScanPage() {
  const user = await getSessionUser()

  if (!user) redirect('/login?next=/scan')

  if (!canAccessScan(user.role)) {
    return (
      <AccessDeniedPage
        title="Scan — Check-in & Validity"
        subtitle="Access restricted."
        signedInAs={user.email}
        message="Only Reception / Admin / Super Admin can access the scanner."
        allowed="reception, admin, super_admin"
        nextPath="/scan"
        actions={[{ href: '/members', label: 'Go to Members' }]}
        showBackHome
      />
    )
  }

  const showAudit = canAccessScan(user.role) && user.role !== 'reception'

  return (
    <main>
      <PageHeader
        title="Scan — Check-in & Validity"
        subtitle="Fast front-desk scanning for attendance, subscription validation and kiosk mode."
      />

      <Section className="max-w-5xl space-y-5">
        <KioskHealthBadge />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QuickLink
            href="/members"
            label="Members"
            desc="Find a member quickly before or after a scan."
            icon={<Users size={18} strokeWidth={2.1} />}
          />
          <QuickLink
            href="/kiosk"
            label="Create member"
            desc="Open the front-desk member creation flow."
            icon={<UserPlus size={18} strokeWidth={2.1} />}
          />
          <QuickLink
            href="/scan?kiosk=1"
            label="Open kiosk mode"
            desc="Sticky full-screen scanner for the entrance."
            icon={<ScanLine size={18} strokeWidth={2.1} />}
          />
          {showAudit ? (
            <QuickLink
              href="/admin/scan-audit"
              label="Scan audit"
              desc="Review scan history, device tag and scanner context."
              icon={<ClipboardList size={18} strokeWidth={2.1} />}
            />
          ) : (
            <div className="hidden xl:block" />
          )}
        </div>

        <KioskScanner size="md" ratio="1:1" />

        <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
          <h2 className="text-base font-semibold tracking-tight">Front-desk tips</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-sm text-[hsl(var(--muted))]">
              Use the back camera when possible and keep only one QR in the frame.
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-sm text-[hsl(var(--muted))]">
              Kiosk mode is better for the entrance because it hides navigation and keeps the screen awake.
            </div>
          </div>
        </div>
      </Section>
    </main>
  )
}