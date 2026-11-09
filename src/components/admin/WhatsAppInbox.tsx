'use client'
import {useEffect,useState} from 'react'
type Conversation={id:string;wa_id:string;display_name:string|null;prospect_id:string|null;last_inbound_at:string|null;last_message_at:string|null;prospects:{full_name:string;status:string}|null}
type Message={id:string;body:string;direction:string;status:string;occurred_at:string;error_code:string|null}
type Template={template_key:string;language:string;label:string;body_template:string}
export default function WhatsAppInbox(){
 const [configured,setConfigured]=useState(false)
 const [rows,setRows]=useState<Conversation[]>([])
 const [templates,setTemplates]=useState<Template[]>([])
 const [templateId,setTemplateId]=useState('')
 const [selected,setSelected]=useState<Conversation|null>(null)
 const [messages,setMessages]=useState<Message[]>([])
 const [draft,setDraft]=useState('')
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 async function load(){
  const r=await fetch('/api/admin/prospects/whatsapp',{cache:'no-store'})
  const data=await r.json()
  if(!r.ok)throw Error(data.error||'Inbox unavailable')
  setRows(data.conversations||[]);setConfigured(data.configured);setTemplates(data.templates||[])
 }
 async function open(row:Conversation){
  setSelected(row);setDraft('');setTemplateId('');setNotice('');setError('')
  const r=await fetch('/api/admin/prospects/whatsapp?conversation_id='+encodeURIComponent(row.id),{cache:'no-store'})
  const data=await r.json()
  if(!r.ok)throw Error(data.error||'Conversation unavailable')
  setMessages(data.messages??[])
 }
 useEffect(()=>{void load().catch(e=>setError(String(e.message??e)))},[])
 const last=selected?.last_inbound_at?new Date(selected.last_inbound_at).getTime():0
 const canReply=Boolean(last&&Date.now()-last<23*3600000)
 async function send(){
  if(!selected||!canReply||!draft.trim()||busy)return
  if(!window.confirm('Send this exact message through the official ATOM WhatsApp number?'))return
  setBusy(true);setError('');setNotice('')
  const requestId=crypto.randomUUID()
  try{
   const r=await fetch('/api/admin/prospects/whatsapp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
     conversation_id:selected.id,client_request_id:requestId,message:draft.trim()
   })})
   const result=await r.json()
   if(!r.ok)throw Error(result.details||result.error||'Send failed')
   setDraft('');setNotice('Accepted by Meta; delivery is not yet confirmed.')
   await open(selected)
   setNotice('Accepted by Meta; delivery is not yet confirmed.')
  }catch(e:any){setError(String(e.message??e))}
  finally{setBusy(false)}
 }
 return <div className="space-y-3">
 {!configured&&<p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">Meta WhatsApp credentials are not configured yet. No incoming messages or outgoing sends will work until the connection is activated.</p>}
 {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
 {notice&&<p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
 <div className="grid gap-4 md:grid-cols-[minmax(200px,1fr)_minmax(320px,2fr)]">
 <section className="rounded-xl border p-3">
 <div className="mb-3 flex items-center justify-between"><strong>Conversations</strong><button className="rounded-lg border px-2 py-1 text-sm" onClick={()=>void load().catch(e=>setError(e.message))}>Refresh</button></div>
 {rows.length===0&&<p className="text-sm text-slate-500">No incoming messages received yet.</p>}
 <div className="space-y-2">{rows.map(row=><button key={row.id} className={'w-full rounded-lg border p-3 text-left text-sm '+(selected?.id===row.id?'border-black bg-slate-100':'')} onClick={()=>void open(row).catch(e=>setError(e.message))}>
 <strong>{row.prospects?.full_name||row.display_name||row.wa_id}</strong>
 <div className="text-xs text-slate-500">{row.wa_id} · {row.prospects?.full_name?'Matched prospect':'Unlinked contact'}</div>
 </button>)}</div></section>
 <section className="rounded-xl border p-4">
 {!selected?<p className="text-sm text-slate-500">Choose a conversation to review its inbound messages and prepare a reply.</p>:<>
 <h2 className="font-semibold">{selected.prospects?.full_name||selected.display_name||selected.wa_id}</h2>
 <p className="mb-4 text-xs text-slate-500">{selected.wa_id} · {canReply?'Customer service window open':'24-hour free-form reply window closed'}</p>
 <div className="max-h-96 space-y-2 overflow-auto rounded-lg bg-slate-50 p-3">
 {messages.map(m=><div key={m.id} className={'max-w-[90%] rounded-lg p-2 text-sm '+(m.direction==='outbound'?'ml-auto bg-emerald-100':'bg-white')}>
 <div className="whitespace-pre-wrap">{m.body}</div><div className="mt-1 text-xs text-slate-500">{m.direction} · {m.status}</div></div>)}
 </div>
 <label className="mt-4 block text-sm font-medium">Suggested message template (editable before sending)
 <select className="mt-1 w-full rounded-lg border p-2" value={templateId} onChange={e=>{
 const value=e.target.value;setTemplateId(value)
 const template=templates.find(t=>t.template_key+':'+t.language===value)
 if(template){
  const first=(selected.prospects?.full_name||selected.display_name||'there').trim().split(/\\s+/)[0]
  setDraft(template.body_template.replace(/{{\\s*first_name\\s*}}/g,first)
    .replace(/{{\\s*requested_class\\s*}}/g,'Jiu-Jitsu')
    .replace(/{{\\s*trial_date\\s*}}/g,'the agreed date'))
 }
 }}>
 <option value="">Write a new message</option>
 {templates.map(t=><option key={t.template_key+':'+t.language} value={t.template_key+':'+t.language}>{t.label} · {t.language.toUpperCase()}</option>)}
 </select></label>
 <label className="mt-4 block text-sm font-medium">Your reviewed reply
 <textarea className="mt-1 w-full rounded-lg border p-2" rows={4} maxLength={4096} value={draft} onChange={e=>setDraft(e.target.value)}
 placeholder="Write or paste a response here. You approve each outbound message."/></label>
 <button type="button" disabled={busy||!configured||!canReply||!draft.trim()} onClick={()=>void send()}
 className="mt-2 rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy?'Sending…':'Review & send via WhatsApp API'}</button>
 {!canReply&&<p className="mt-2 text-xs text-amber-800">Outside the customer-service window, only approved Meta templates with valid opt-in are allowed; not enabled in this phase.</p>}
 </>}
 </section></div></div>
}
