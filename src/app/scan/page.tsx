// src/app/scan/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ClipboardList, ScanLine, UserPlus, Users } from 'lucide-react'
import { getSessionUser } from '@/lib/session'
import KioskScanner from '@/components/KioskScanner'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import KioskHealthBadge from '@/components/KioskHealthBadge'
import { canAccessScan } from '@/lib/rbac'

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
        message="Only Reception / Scan Terminal / Admin / Super Admin can access the scanner."
        allowed="reception, scan_terminal, admin, super_admin"
        nextPath="/scan"
        actions={[{ href: '/members', label: 'Go to Members' }]}
        showBackHome
      />
    )
  }

  const isTerminal = user.role === 'scan_terminal'
  const showAudit = user.role === 'admin' || user.role === 'super_admin'

  if (isTerminal) {
    return (
      <main className="min-h-[100dvh] bg-[hsl(var(--bg))]">
        <Section className="flex min-h-[100dvh] max-w-3xl items-center justify-center px-4 py-4 sm:px-6">
          <div className="w-full space-y-4">
            <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 text-center shadow-soft">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--muted))]">Door scanner</div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-black">Scan member QR</h1>
              <p className="mt-2 text-sm text-[hsl(var(--muted))]">
                Front camera locked. Result shows on screen, then scanning restarts automatically after 7 seconds.
              </p>
            </div>
            <KioskScanner size="lg" ratio="1:1" terminalLocked />
          </div>
        </Section>
      </main>
    )
  }

  return (
    <main>
      <PageHeader
        title="Scan — Check-in & Validity"
        subtitle="Fast front-desk scanning with optional kiosk mode."
      />

      <Section className="max-w-5xl space-y-5">
        <KioskHealthBadge />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QuickLink
            href="/members"
            label="Members"
            desc="Find a member before or after a scan."
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
            label="Enable kiosk mode"
            desc="Keep kiosk mode available inside this page. Full screen stays manual."
            icon={<ScanLine size={18} strokeWidth={2.1} />}
          />
          {showAudit ? (
            <QuickLink
              href="/admin/scan-audit"
              label="Scan audit"
              desc="Review scan history and device context."
              icon={<ClipboardList size={18} strokeWidth={2.1} />}
            />
          ) : (
            <div className="hidden xl:block" />
          )}
        </div>

        <KioskScanner size="md" ratio="1:1" />
      </Section>
    </main>
  )
}
