export const dynamic='force-dynamic'
import {redirect} from 'next/navigation'
import {getSessionUserCached} from '@/lib/requestCache'
import WhatsAppInbox from '@/components/admin/WhatsAppInbox'
export default async function WhatsAppInboxPage(){
 const me=await getSessionUserCached()
 if(!me)redirect('/login?next=/admin/prospects/whatsapp')
 if(!['super_admin','admin','reception'].includes(me.role))return <main className="p-8">Access denied.</main>
 return <main className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
 <h1 className="text-2xl font-semibold">WhatsApp Business Inbox</h1>
 <p className="text-sm text-slate-600">Meta Cloud API · Human-reviewed replies only. No AI auto-replies or campaigns. Delivery statuses come from Meta webhooks.</p>
 <WhatsAppInbox/>
 </main>
}
