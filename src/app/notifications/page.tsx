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
        subtitle={
          canManage
            ? 'Send announcements with clearer role targeting, estimated recipient counts, and stronger delivery feedback.'
            : 'Read updates, triage unread items first, and manage your inbox status faster.'
        }
      />

      <Section className="space-y-6">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
            <div className="text-sm font-semibold">Inbox triage</div>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              Put unread or recent items first when you need to clear the inbox quickly.
            </p>
          </div>

          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
            <div className="text-sm font-semibold">Bulk actions</div>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              Select multiple rows to mark them read, unread, or delete them in one pass.
            </p>
          </div>

          {canManage && (
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
              <div className="text-sm font-semibold">Targeting clarity</div>
              <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                Before sending, the admin composer now shows who is eligible to receive the message and the estimated recipient count.
              </p>
            </div>
          )}

          {canManage && (
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
              <div className="text-sm font-semibold">Delivery feedback</div>
              <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                After sending, the admin sees how many eligible recipients were reached and what was filtered out or unmatched.
              </p>
            </div>
          )}

          {hasInbox && (
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
              <div className="text-sm font-semibold">Your role inbox</div>
              <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                Members, champions, VIPs, coaches, assistant coaches, and head coaches can read the notifications sent from the admin center here.
              </p>
            </div>
          )}
        </div>

        {canManage && <NotificationsSender />}

        {hasInbox && <NotificationsList />}

        {canManage && <NotificationsList isAdmin sentOnly />}

        {canManage && <NotificationsMemberInbox canDelete />}
      </Section>
    </main>
  )
}
