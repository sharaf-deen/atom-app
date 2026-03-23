// src/app/training-useful/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import type React from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  ArrowRight,
  Bell,
  CalendarDays,
  Gift,
  IdCard,
  Info,
  LayoutDashboard,
  ScanLine,
  ShieldCheck,
  UserRoundSearch,
} from 'lucide-react'
import { createSupabaseRSC } from '@/lib/supabaseServer'
import { getSessionUser, type Role } from '@/lib/session'
import { canAccessTrainingUseful } from '@/lib/rbac'
import HomeMemberLookup from '@/components/home/HomeMemberLookup'
import HomeNotificationsTile from '@/components/HomeNotificationsTile'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import QrImage from '@/components/QrImage'

type ProfileLite = {
  qr_code: string | null
  member_id: string | null
  created_at: string | null
}

type QuickLink = {
  href: string
  label: string
  desc: string
  icon: React.ComponentType<{ size?: number | string; className?: string }>
}

function Surface({ children, className = '' }: React.PropsWithChildren<{ className?: string }>) {
  return <section className={`rounded-3xl border border-[hsl(var(--border))] bg-white shadow-soft ${className}`}>{children}</section>
}

function fmtDate(d?: string | null) {
  if (!d) return '—'
  const dt = d.length === 10 ? new Date(`${d}T00:00:00Z`) : new Date(d)
  if (Number.isNaN(dt.getTime())) return d
  return new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'short', day: '2-digit' }).format(dt)
}

function roleLabel(role: Role) {
  switch (role) {
    case 'coach':
      return 'Coach'
    case 'assistant_coach':
      return 'Assistant coach'
    case 'head_coach':
      return 'Head coach'
    case 'admin':
      return 'Admin preview'
    case 'super_admin':
      return 'Super admin preview'
    default:
      return 'Staff'
  }
}

function coachLinks(role: Role): QuickLink[] {
  const base: QuickLink[] = [
    { href: '/profile', label: 'My profile', desc: 'Identity, QR code and personal info.', icon: IdCard },
    { href: '/schedule', label: 'Schedule', desc: 'Open the latest class schedule.', icon: CalendarDays },
    { href: '/notifications', label: 'Notifications', desc: 'Read the latest staff updates.', icon: Bell },
    { href: '/packages-and-promos', label: 'Packages & promos', desc: 'Keep current offers close on the mat.', icon: Gift },
  ]

  if (role === 'coach' || role === 'head_coach') {
    base.splice(1, 0, {
      href: '/members',
      label: 'Member lookup',
      desc: 'Open limited read-only member access when you need to help quickly.',
      icon: UserRoundSearch,
    })
  }

  if (role === 'admin' || role === 'super_admin') {
    base.unshift({
      href: '/coaches',
      label: 'Coaches admin',
      desc: 'Jump back to the coach management workspace.',
      icon: LayoutDashboard,
    })
  }

  return base
}

async function getUnreadNotificationsCount(userId: string) {
  const supabase = createSupabaseRSC()
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null)
    .is('deleted_for_user_at', null)

  return count ?? 0
}

async function getProfileLite(userId: string): Promise<ProfileLite | null> {
  const supabase = createSupabaseRSC()
  const { data } = await supabase
    .from('profiles')
    .select('qr_code, member_id, created_at')
    .eq('user_id', userId)
    .maybeSingle<ProfileLite>()

  return data ?? null
}

export default async function TrainingUsefulPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login?next=/training-useful')
  if (!canAccessTrainingUseful(user.role)) redirect('/')

  const [profile, unreadCount] = await Promise.all([
    getProfileLite(user.id),
    getUnreadNotificationsCount(user.id),
  ])

  const qrCode = user.qr_code ?? profile?.qr_code ?? null
  const links = coachLinks(user.role)
  const joinedHint = profile?.created_at ? `Staff account active since ${fmtDate(profile.created_at)}` : 'Staff tools are ready for daily use.'
  const isCoachView = user.role === 'coach' || user.role === 'head_coach'
  const isAssistantView = user.role === 'assistant_coach'

  return (
    <main>
      <PageHeader
        title="Training useful"
        subtitle="Fast coach tools for the training floor: QR, schedule, staff updates and the most useful next actions."
        right={<Button asChild href="/schedule" variant="outline">Open schedule</Button>}
      />

      <Section className="space-y-6">
        <Surface className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">{roleLabel(user.role)}</Badge>
                <Badge className="bg-[hsl(var(--bg))] text-[hsl(var(--muted))]">Training floor shortcuts</Badge>
              </div>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Useful today, with less tapping</h2>
                <p className="mt-2 max-w-2xl text-sm text-[hsl(var(--muted))]">
                  {isCoachView
                    ? 'Your hub keeps QR, schedule, staff updates and read-only member lookup in one place.'
                    : isAssistantView
                      ? 'Your hub keeps QR, schedule, staff updates and the most useful field shortcuts together.'
                      : 'Preview the coach-facing hub and the shortcuts available during daily training operations.'}
                </p>
              </div>
              <p className="text-xs text-[hsl(var(--muted))]">{joinedHint}</p>
            </div>

            <div className="grid w-full gap-3 sm:grid-cols-2 lg:max-w-md">
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">QR readiness</div>
                <div className="mt-2 text-lg font-semibold tracking-tight">{qrCode ? 'Ready for entry' : 'Check profile first'}</div>
                <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                  {qrCode ? 'Your QR code is ready for daily access.' : 'Open your profile to confirm your QR code is available.'}
                </p>
              </div>
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Staff updates</div>
                <div className="mt-2 text-lg font-semibold tracking-tight">{unreadCount > 0 ? `${unreadCount} unread` : 'Inbox up to date'}</div>
                <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                  {unreadCount > 0 ? 'Check your latest staff instructions before the next class starts.' : 'No unread staff update right now.'}
                </p>
              </div>
            </div>
          </div>
        </Surface>

        <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <Surface className="p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold tracking-tight">My QR code</div>
                <p className="mt-1 text-sm text-[hsl(var(--muted))]">Use this code for fast staff entry at the desk.</p>
              </div>
              <ShieldCheck size={18} className="mt-0.5 text-black" />
            </div>
            <div className="mt-4 flex min-h-[180px] items-center justify-center rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-3">
              {qrCode ? <QrImage value={qrCode} size={150} /> : <div className="text-sm text-[hsl(var(--muted))]">No QR code available.</div>}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild href="/profile" variant="outline"><span>Open profile</span></Button>
              <Button asChild href="/schedule" variant="outline"><span>Open schedule</span></Button>
            </div>
          </Surface>

          <div className="space-y-4">
            <HomeNotificationsTile
              href="/notifications"
              label="Staff updates"
              desc="Open your inbox and unread coach notifications."
              initialCount={unreadCount}
            />

            <Surface className="p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <Info size={18} className="mt-0.5 text-black" />
                <div>
                  <div className="text-sm font-semibold tracking-tight">Role cue</div>
                  <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                    {isCoachView
                      ? 'Coach access includes a limited read-only member lookup with no financial or private contact data.'
                      : isAssistantView
                        ? 'Assistant coach access is optimized for QR, schedule, notifications and useful field shortcuts.'
                        : 'Admins can preview the coach-facing shortcuts here without changing the coach management page.'}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild href="/schedule" variant="outline"><span>Open schedule</span></Button>
                <Button asChild href="/packages-and-promos" variant="outline"><span>Open offers</span></Button>
              </div>
            </Surface>
          </div>
        </div>

        <Surface className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Training quick actions</h2>
              <p className="mt-1 text-sm text-[hsl(var(--muted))]">The shortest path to the tools coaches actually need on the floor.</p>
            </div>
            <Badge className="bg-[hsl(var(--bg))] text-[hsl(var(--muted))]">Today-first shortcuts</Badge>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {links.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft transition hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold tracking-tight">{item.label}</div>
                    <p className="mt-1 text-sm text-[hsl(var(--muted))]">{item.desc}</p>
                  </div>
                  <item.icon size={18} className="mt-0.5 text-black transition group-hover:translate-x-0.5" />
                </div>
                <div className="mt-4 inline-flex items-center gap-1 text-sm font-medium">
                  Open
                  <ArrowRight size={15} />
                </div>
              </Link>
            ))}
          </div>
        </Surface>

        {isCoachView ? (
          <HomeMemberLookup
            title="Quick member lookup"
            subtitle="Coach access is read-only. Search by first name, last name or member ID."
            canOpenProfile
            showSensitiveFields={false}
          />
        ) : null}

        {!isCoachView ? (
          <Surface className="p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <ScanLine size={18} className="mt-0.5 text-black" />
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Useful next step</h2>
                <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                  {isAssistantView
                    ? 'Keep the day moving with schedule, QR and staff updates first. Open notifications before class if you have unread items.'
                    : 'Use this page as a quick preview of the coach-facing shortcuts, then go back to the admin or coaches workspace when needed.'}
                </p>
              </div>
            </div>
          </Surface>
        ) : null}
      </Section>
    </main>
  )
}
