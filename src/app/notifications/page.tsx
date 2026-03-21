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
  const isAdmin = role === 'admin'
  const isSuper = role === 'super_admin'
  const isMember = role === 'member'
  const isCoach = role === 'coach'
  const isAssistantCoach = role === 'assistant_coach'

  return (
    <main>
      <PageHeader
        title="Notifications"
        subtitle={
          isAdmin || isSuper
            ? 'Send announcements, review sent messages, and manage your admin inbox read flow.'
            : 'Read updates, open message details, and manage your inbox read status.'
        }
      />

      <Section className="space-y-6">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
            <div className="text-sm font-semibold">Inbox flow</div>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              Open a message to read the full content, then mark it read or unread when needed.
            </p>
          </div>

          {(isMember || isCoach || isAssistantCoach) && (
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
              <div className="text-sm font-semibold">Your role inbox</div>
              <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                Members, coaches, and assistant coaches can read the notifications sent from the admin center here.
              </p>
            </div>
          )}

          {(isAdmin || isSuper) && (
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
              <div className="text-sm font-semibold">Admin inbox scope</div>
              <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                Admins manage sent announcements here and also read member messages sent directly to the admin inbox.
              </p>
            </div>
          )}
        </div>

        {(isAdmin || isSuper) && <NotificationsSender />}

        {(isMember || isCoach || isAssistantCoach) && <NotificationsList />}

        {(isAdmin || isSuper) && <NotificationsList isAdmin sentOnly />}

        {(isAdmin || isSuper) && <NotificationsMemberInbox canDelete />}
      </Section>
    </main>
  )
}
