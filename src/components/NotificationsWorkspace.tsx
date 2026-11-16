'use client'

import { useState } from 'react'
import { Inbox, Send, MessageSquare, PenSquare } from 'lucide-react'
import NotificationsList from '@/components/NotificationsList'
import NotificationsMemberInbox from '@/components/NotificationsMemberInbox'
import NotificationsSender from '@/components/NotificationsSender'

type Tab='inbox'|'sent'|'member'|'compose'
const options:{value:Tab;title:string;description:string;icon:typeof Inbox}[]=[
  {value:'inbox',title:'Inbox',description:'Messages received',icon:Inbox},
  {value:'sent',title:'Sent',description:'Messages you sent',icon:Send},
  {value:'member',title:'Member messages',description:'Replies from members',icon:MessageSquare},
  {value:'compose',title:'Compose',description:'Send a notification',icon:PenSquare},
]

export default function NotificationsWorkspace({hasInbox}:{hasInbox:boolean}){
  const [tab,setTab]=useState<Tab>(hasInbox?'inbox':'sent')
  return <section className="space-y-4">
    <nav aria-label="Notification sections" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {options.filter(t=>hasInbox||t.value!=='inbox').map(item=>{
        const Icon=item.icon
        const selected=tab===item.value
        return <button key={item.value} type="button" onClick={()=>setTab(item.value)}
          aria-current={selected?'page':undefined}
          className={'flex min-w-0 items-center gap-3 rounded-2xl border p-3 text-left transition sm:p-4 '+
            (selected?'border-slate-900 bg-slate-900 text-white shadow-sm':'border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:bg-slate-50')}>
          <Icon size={19} className="shrink-0"/>
          <span className="min-w-0"><span className="block truncate text-sm font-semibold">{item.title}</span>
            <span className={'mt-0.5 hidden text-xs sm:block '+(selected?'text-slate-200':'text-[hsl(var(--muted))]')}>{item.description}</span></span>
        </button>
      })}
    </nav>
    <div className="min-w-0">
      {tab==='inbox'&&hasInbox?<NotificationsList isAdmin/>:null}
      {tab==='sent'?<NotificationsList isAdmin sentOnly/>:null}
      {tab==='member'?<NotificationsMemberInbox canDelete/>:null}
      {tab==='compose'?<NotificationsSender/>:null}
    </div>
    <p className="text-xs text-[hsl(var(--muted))]">
      Removing a message hides it only from your view. The original notification record and the recipient&apos;s copy remain available.
      Only the open section is loaded.
    </p>
  </section>
}
