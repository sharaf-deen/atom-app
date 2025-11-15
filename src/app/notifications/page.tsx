// src/app/notifications/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

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
            ? 'Create announcements and review sent messages'
            : 'Your announcements and updates'
        }
      />

      <Section className="space-y-6">
        {/* Création d'annonces (admin + super_admin) */}
        {(isAdmin || isSuper) && (
            <NotificationsSender />
        )}

        {/* 
          - member / coach / assistant_coach : inbox générale
          - admin / super_admin : liste "sentOnly" (comme demandé)
        */}
        {(isMember || isCoach || isAssistantCoach) && (
            <NotificationsList />
        )}

        {(isAdmin || isSuper) && (
            <NotificationsList isAdmin sentOnly />
        )}

        {/* Bloc inbox “member messages” réservé aux super_admin */}
        {isSuper && (
            <NotificationsMemberInbox />
        )}
      </Section>
    </main>
  )
}
