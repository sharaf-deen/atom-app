export const dynamic='force-dynamic'
export const revalidate=0

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/session'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import NotificationsList from '@/components/NotificationsList'
import NotificationsWorkspace from '@/components/NotificationsWorkspace'
import { canManageNotifications, hasVisibleNotificationInbox } from '@/lib/rbac'

type Props={searchParams?:{thread?:string|string[];discussion?:string|string[]}}
function one(value:string|string[]|undefined){return Array.isArray(value)?value[0]:value}

export default async function NotificationsPage({searchParams}:Props){
  const me=await getSessionUser()
  if(!me)redirect('/login?next=/notifications')
  if(me.role==='reception')redirect('/')

  const canManage=canManageNotifications(me.role)
  const hasInbox=hasVisibleNotificationInbox(me.role)
  const thread=one(searchParams?.thread)||one(searchParams?.discussion)||null

  return <main>
    <PageHeader
      title={canManage?'Notifications':'Discussions'}
      subtitle={canManage?'Manage your inbox, sent messages and member replies in one place.':'Read your ATOM messages and updates.'}
    />
    <Section className="space-y-4">
      {canManage
        ?<NotificationsWorkspace hasInbox={hasInbox}/>
        :hasInbox
          ?<NotificationsList initialThread={thread}/>
          :<p className="rounded-2xl border p-5 text-sm text-[hsl(var(--muted))]">No notification inbox is available for this account.</p>
      }
    </Section>
  </main>
}
