// src/app/notifications/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import NotificationsSender from '@/components/NotificationsSender'
import NotificationsList from '@/components/NotificationsList'
import NotificationsMemberInbox from '@/components/NotificationsMemberInbox'
import Badge from '@/components/ui/Badge'
import { canManageNotifications, hasVisibleNotificationInbox } from '@/lib/rbac'

export default async function NotificationsPage() {
  const me = await getSessionUser()

  if (!me) {
    return (
      <main>
        <PageHeader title="Notifications" subtitle="Stay up to date with announcements" />
        <Section>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
            <h2 className="text-base font-semibold">Please sign in</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              You need to be authenticated to access your notifications.
            </p>
          </div>
        </Section>
      </main>
    )
  }

  if (me.role === 'reception') {
    redirect('/')
  }

  const role = me.role
  const canManage = canManageNotifications(role)
  const hasInbox = hasVisibleNotificationInbox(role)

  return (
    <main>
      <PageHeader
        title="Notifications"
        subtitle={canManage ? 'Send clearly. Read quickly. Keep only the useful updates visible.' : 'Unread first, clear actions, and faster reading.'}
      />

      <Section className="space-y-6">
        <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold tracking-tight">Clearer notifications, less noise</h2>
                {canManage ? <Badge>Admin tools</Badge> : <Badge>Inbox</Badge>}
              </div>
              <p className="mt-2 text-base leading-7 text-[hsl(var(--muted))]">
                This screen is now meant for 3 quick actions: check unread items, send one useful message, and remove what is no longer needed.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[320px]">
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--muted))]">Priority</div>
                <div className="mt-1 text-base font-semibold">Unread first</div>
                <p className="mt-1 text-sm leading-6 text-[hsl(var(--muted))]">Read the newest important items before everything else.</p>
              </div>

              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--muted))]">Actions</div>
                <div className="mt-1 text-base font-semibold">Read, unread, delete</div>
                <p className="mt-1 text-sm leading-6 text-[hsl(var(--muted))]">The essential actions stay visible without extra noise.</p>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            {hasInbox ? <Badge className="px-3 py-1">Personal inbox</Badge> : null}
            {canManage ? <Badge className="px-3 py-1">Send notifications</Badge> : null}
            {canManage ? <Badge className="px-3 py-1">Sent history</Badge> : null}
            {canManage ? <Badge className="px-3 py-1">Member messages</Badge> : null}
          </div>
        </div>

        {canManage ? (
          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Send</h2>
              <p className="text-sm text-[hsl(var(--muted))]">Compose one message, choose the right audience, then send.</p>
            </div>
            <NotificationsSender />
          </div>
        ) : null}

        {hasInbox ? (
          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Inbox</h2>
              <p className="text-sm text-[hsl(var(--muted))]">Unread and important items stay easy to spot.</p>
            </div>
            <NotificationsList />
          </div>
        ) : null}

        {canManage ? (
          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Sent</h2>
              <p className="text-sm text-[hsl(var(--muted))]">Review what was sent and remove rows you no longer need.</p>
            </div>
            <NotificationsList isAdmin sentOnly />
          </div>
        ) : null}

        {canManage ? (
          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Member messages</h2>
              <p className="text-sm text-[hsl(var(--muted))]">Review direct messages sent by members in one place.</p>
            </div>
            <NotificationsMemberInbox canDelete />
          </div>
        ) : null}
      </Section>
    </main>
  )
}
