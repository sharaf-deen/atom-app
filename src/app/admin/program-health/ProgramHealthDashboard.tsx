'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export type ProgramMember = {
  user_id:string;member_id:string|null;name:string;active:boolean;visited_30:boolean
}
export type ProgramHealth = {
  key:string;name:string;audience:string;level:string;is_active:boolean
  target_capacity:number|null;warning_percent:number;management_note:string
  enrolled:number;active:number;inactive:number;visited_30:number;joined_30:number;left_30:number
  gross_30:number;gross_90:number;net_30:number;net_90:number
  members:ProgramMember[]
}
type Snapshot={as_of:string;methodology:string;programs:ProgramHealth[]}
const money = (n:number)=>new Intl.NumberFormat('en-EG',{maximumFractionDigits:0}).format(Number(n)||0)+' EGP'
type Status='not_set'|'empty'|'room'|'watch'|'full'
function statusOf(p:ProgramHealth):Status {
  if(p.target_capacity==null)return 'not_set'
  if(p.enrolled===0)return 'empty'
  if(p.enrolled>=p.target_capacity)return 'full'
  if((p.enrolled/p.target_capacity)*100>=p.warning_percent)return 'watch'
  return 'room'
}
const statuses:Record<Status,string>={
 not_set:'Set capacity',empty:'No enrollments',room:'Healthy capacity',
 watch:'Near target',full:'At / over target'
}
const statusClasses:Record<Status,string>={
 not_set:'bg-slate-100 text-slate-700',empty:'bg-slate-100 text-slate-700',
 room:'bg-emerald-50 text-emerald-800',watch:'bg-amber-50 text-amber-900',
 full:'bg-rose-50 text-rose-800'
}
function Settings({program,done}:{program:ProgramHealth;done:()=>void}){
  const [capacity,setCapacity]=useState(program.target_capacity?.toString()??'')
  const [warning,setWarning]=useState(program.warning_percent.toString())
  const [note,setNote]=useState(program.management_note)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  async function save(){
    setError('')
    const capacityNumber=capacity.trim()?Number(capacity):null
    const warningNumber=Number(warning)
    if((capacityNumber!==null&&(!Number.isInteger(capacityNumber)||capacityNumber<1||capacityNumber>500))
      ||!Number.isInteger(warningNumber)||warningNumber<50||warningNumber>100){
      setError('Capacity must be 1–500; warning threshold 50–100%.');return
    }
    setBusy(true)
    try{
      const response=await fetch('/api/admin/program-health',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({programKey:program.key,capacity:capacityNumber,warningPercent:warningNumber,note})
      })
      if(!response.ok)throw new Error('Could not save program settings.')
      done()
    }catch(e){setError(e instanceof Error?e.message:'Save failed.')}
    finally{setBusy(false)}
  }
  return <div className="mt-4 space-y-3 rounded-xl border bg-slate-50 p-4">
    <p className="font-semibold">Program management</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-medium">Enrollment target (people)
        <input type="number" min="1" max="500" placeholder="Not set"
          className="mt-1 block w-full rounded-lg border bg-white p-2"
          value={capacity} onChange={e=>setCapacity(e.target.value)}/>
      </label>
      <label className="text-sm font-medium">Warn at % of target
        <input type="number" min="50" max="100" step="1"
          className="mt-1 block w-full rounded-lg border bg-white p-2"
          value={warning} onChange={e=>setWarning(e.target.value)}/>
      </label>
    </div>
    <label className="block text-sm font-medium">Management notes / actions
      <textarea rows={3} maxLength={2000} className="mt-1 block w-full rounded-lg border bg-white p-2"
        placeholder="Example: Open a second group after 18 registrations; call inactive families."
        value={note} onChange={e=>setNote(e.target.value)}/>
    </label>
    <p className="text-xs text-slate-500">The target is a total program enrollment target, not the number physically attending one class. Changes are audited.</p>
    {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
    <button disabled={busy} onClick={()=>void save()}
      className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
      {busy?'Saving…':'Save program settings'}
    </button>
  </div>
}

export default function ProgramHealthDashboard({snapshot}:{snapshot:Snapshot}){
  const router=useRouter()
  const [search,setSearch]=useState('')
  const [filter,setFilter]=useState('all')
  const [expanded,setExpanded]=useState<string[]>([])
  const [editing,setEditing]=useState<string[]>([])
  const all=useMemo(()=>snapshot.programs??[],[snapshot.programs])
  const displayed=useMemo(()=>all.filter(p=>{
    const matches=(p.name+' '+p.key+' '+p.level).toLowerCase().includes(search.toLowerCase())
    return matches&&(filter==='all'||(filter==='alerts'&&['watch','full','not_set'].includes(statusOf(p)))
      ||(filter==='empty'&&p.enrolled===0)||(filter==='active'&&p.enrolled>0))
  }),[all,search,filter])
  const totals=all.reduce((a,p)=>({enrolled:a.enrolled+p.enrolled,active:a.active+p.active,
    net30:a.net30+Number(p.net_30||0),needsAttention:a.needsAttention+(statusOf(p)==='watch'||statusOf(p)==='full'?1:0)}),
    {enrolled:0,active:0,net30:0,needsAttention:0})
  const toggle=(key:string,setter:(fn:(prior:string[])=>string[])=>void)=>
    setter(old=>old.includes(key)?old.filter(x=>x!==key):[...old,key])
  return <div className="space-y-6">
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {[
        ['Current enrollments',totals.enrolled.toLocaleString()],
        ['Active subscriptions',totals.active.toLocaleString()],
        ['Near / over target',totals.needsAttention.toLocaleString()],
        ['Attributed net cash · 30d',money(totals.net30)]
      ].map(([label,value])=><div key={label} className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="mt-2 text-2xl font-semibold">{value}</div>
      </div>)}
    </div>
    <div className="rounded-2xl border bg-white p-4">
      <p className="text-sm font-semibold">How to read this dashboard</p>
      <p className="mt-1 text-sm text-slate-600">Enrolled = distinct current assigned members, excluding archived profiles. Active = current assigned members with an active subscription valid today. Visited 30d = members with at least one valid attendance scan in the last 30 calendar days.</p>
      <p className="mt-2 text-sm text-slate-600">{snapshot.methodology} Each member assigned to multiple programs has their cash split equally between those programs; this is an estimate, not actual program-level bookkeeping.</p>
      <p className="mt-2 text-xs text-slate-500">Snapshot as of {snapshot.as_of} (Cairo). Current assignments are used for revenue attribution, including historical payments; changing a member&apos;s program will change this estimate. Revenue is not profit and does not include expenses.</p>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <label className="grow text-sm">Search programs
        <input className="mt-1 block w-full rounded-xl border bg-white p-3"
          placeholder="Program name or level" value={search} onChange={e=>setSearch(e.target.value)}/>
      </label>
      <label className="text-sm">View
        <select className="mt-1 block rounded-xl border bg-white p-3"
          value={filter} onChange={e=>setFilter(e.target.value)}>
          <option value="all">All programs</option><option value="alerts">Needs attention / target</option>
          <option value="active">With enrollments</option><option value="empty">Empty programs</option>
        </select>
      </label>
    </div>
    <div className="space-y-4">
      {displayed.map(p=>{
        const status=statusOf(p)
        const pct=p.target_capacity?Math.round((p.enrolled/p.target_capacity)*100):null
        const isExpanded=expanded.includes(p.key)
        const isEditing=editing.includes(p.key)
        return <section key={p.key} className="rounded-2xl border bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">{p.name}</h2>
              <div className="mt-1 text-xs text-slate-500">{p.audience} · {p.level} · {p.is_active?'Catalog active':'Catalog inactive'}</div>
            </div>
            <span className={'rounded-full px-3 py-1 text-xs font-semibold '+statusClasses[status]}>{statuses[status]}</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div><div className="text-xs text-slate-500">Enrolled</div><div className="text-xl font-semibold">{p.enrolled}</div></div>
            <div><div className="text-xs text-slate-500">Active</div><div className="text-xl font-semibold">{p.active}</div></div>
            <div><div className="text-xs text-slate-500">Inactive</div><div className="text-xl font-semibold">{p.inactive}</div></div>
            <div><div className="text-xs text-slate-500">Visited · 30d</div><div className="text-xl font-semibold">{p.visited_30}</div></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-600">
            <span><strong className="text-emerald-700">+{p.joined_30}</strong> new enrollments · 30d</span>
            <span><strong className="text-slate-800">−{p.left_30}</strong> assignments ended · 30d</span>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Enrollment target</span>
              <span>{p.target_capacity==null?'Not configured':p.enrolled+' / '+p.target_capacity+' ('+pct+'%)'}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              {p.target_capacity!=null&&<div className={'h-full rounded-full '+(status==='full'?'bg-rose-600':status==='watch'?'bg-amber-500':'bg-emerald-600')}
                style={{width:Math.min(pct??0,100)+'%'}}/>}
            </div>
          </div>
          <div className="mt-4 grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-2">
            <div><span className="text-xs text-slate-500">Attributed net payments · 30d</span><p className="text-lg font-semibold">{money(p.net_30)}</p><span className="text-xs text-slate-500">Gross: {money(p.gross_30)}</span></div>
            <div><span className="text-xs text-slate-500">Attributed net payments · 90d</span><p className="text-lg font-semibold">{money(p.net_90)}</p><span className="text-xs text-slate-500">Gross: {money(p.gross_90)}</span></div>
          </div>
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <strong>Suggested action: </strong>
            {status==='full'?'Review class demand and consider opening another group or adjusting the enrollment target.':
              status==='watch'?'Monitor class density and prepare an additional group if demand continues.':
              status==='not_set'?'Set an enrollment target to activate capacity alerts.':
              status==='empty'?'Review scheduling and promote this program to prospects.':
              p.inactive>0?'Follow up with members whose subscriptions are inactive.':
              p.visited_30<p.active?'Review attendance and check in with members who have not scanned recently.':
              'Continue monitoring retention, registrations and attendance.'}
          </div>
          {p.management_note&&<p className="mt-3 rounded-xl border-l-4 border-slate-300 bg-slate-50 p-3 text-sm"><strong>Management note:</strong> {p.management_note}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={()=>toggle(p.key,setExpanded)} className="rounded-xl border px-3 py-2 text-sm font-semibold">
              {isExpanded?'Hide members':'View members ('+p.enrolled+')'}
            </button>
            <button onClick={()=>toggle(p.key,setEditing)} className="rounded-xl border px-3 py-2 text-sm font-semibold">
              {isEditing?'Close settings':'Set target & actions'}
            </button>
            <Link href="/admin/members" className="rounded-xl border px-3 py-2 text-sm font-semibold">Manage members</Link>
            <Link href="/schedule" className="rounded-xl border px-3 py-2 text-sm font-semibold">Review schedule</Link>
          </div>
          {isExpanded&&<div className="mt-4 max-h-80 overflow-y-auto rounded-xl border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50"><tr><th className="p-3">Member</th><th className="p-3">Subscription</th><th className="p-3">Visited</th></tr></thead>
              <tbody>{(p.members??[]).map(m=><tr key={m.user_id} className="border-t">
                <td className="p-3"><Link className="font-medium underline" href={'/members/'+encodeURIComponent(m.user_id)}>{m.name||m.member_id||'Member'}</Link><div className="text-xs text-slate-500">{m.member_id}</div></td>
                <td className="p-3">{m.active?'Active':'Inactive'}</td>
                <td className="p-3">{m.visited_30?'Last 30d':'No visit 30d'}</td>
              </tr>)}</tbody>
            </table>
          </div>}
          {isEditing&&<Settings key={p.key+String(p.target_capacity)+p.management_note} program={p} done={()=>{setEditing(old=>old.filter(x=>x!==p.key));router.refresh()}}/>}
        </section>
      })}
      {displayed.length===0&&<p className="rounded-xl border bg-white p-5 text-sm text-slate-500">No programs match the selected filter.</p>}
    </div>
  </div>
}
