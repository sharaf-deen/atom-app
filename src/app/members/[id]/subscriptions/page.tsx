export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, CreditCard, History, Wallet } from 'lucide-react'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseRSC } from '@/lib/supabaseServer'
import { getSessionUser } from '@/lib/session'
import { cairoToday, diffDays } from '@/lib/cairoDate'
import { hasLifetimeGymAccess } from '@/lib/rbac'

type Subscription = {
  id:string
  plan:string|null
  subscription_type:string|null
  status:string|null
  start_date:string|null
  end_date:string|null
  frozen_from:string|null
  frozen_until:string|null
  sessions_total:number|null
  sessions_used:number|null
  remaining_classes:number|null
  amount:number|null
  amount_due:number|null
  payment_method:string|null
  paid_at:string|null
  created_at:string|null
}
type Member={user_id:string;member_id:string|null;first_name:string|null;last_name:string|null;role:string|null;archived_at:string|null}
const SELECT='id,plan,subscription_type,status,start_date,end_date,frozen_from,frozen_until,sessions_total,sessions_used,remaining_classes,amount,amount_due,payment_method,paid_at,created_at'
const PER_PAGE=20
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isCurrent(row:Subscription,today:string){
  if(row.status!=='active') return false
  if(row.start_date && row.start_date>today) return false
  const sessions=row.subscription_type==='sessions'||row.plan==='sessions'
  if(sessions) {
    const remaining=row.remaining_classes??Math.max(Number(row.sessions_total??0)-Number(row.sessions_used??0),0)
    return remaining>0
  }
  return !!row.end_date&&row.end_date>=today
}
function labelPlan(plan:string|null){
  const labels:Record<string,string>={'1w':'1 week','1m':'1 month','3m':'3 months','6m':'6 months','12m':'12 months',sessions:'Sessions'}
  return labels[plan??'']??(plan||'Membership')
}
function date(s:string|null){
  if(!s)return '—'
  const d=new Date((s.length===10?s+'T00:00:00Z':s))
  return Number.isNaN(d.valueOf())?s:new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(d)
}
function money(n:number|null){return n===null?'—':new Intl.NumberFormat('en-EG',{style:'currency',currency:'EGP'}).format(n)}
function statusLabel(sub:Subscription,today:string){
  if(isCurrent(sub,today)){
    if(sub.subscription_type!=='sessions'&&sub.plan!=='sessions'&&sub.frozen_until&&sub.frozen_until>today
      &&(!sub.frozen_from||sub.frozen_from<=today))return 'Frozen'
    return 'Active'
  }
  if(sub.status!=='active')return sub.status||'Unknown'
  if(sub.start_date&&sub.start_date>today)return 'Upcoming'
  if(sub.end_date&&sub.end_date<today)return 'Expired'
  return sub.status||'Unknown'
}
function SubscriptionCard({row,today}:{row:Subscription;today:string}){
  const sessions=row.subscription_type==='sessions'||row.plan==='sessions'
  const remaining=row.remaining_classes??Math.max(Number(row.sessions_total??0)-Number(row.sessions_used??0),0)
  const status=statusLabel(row,today)
  const days=row.end_date?diffDays(today,row.end_date):null
  return <article className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-sm sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-base font-semibold">{labelPlan(row.plan)}</h3>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">{date(row.start_date)} – {date(row.end_date)}</p>
      </div>
      <span className={'rounded-full border px-3 py-1 text-xs font-semibold '+(status==='Active'?'border-emerald-300 bg-emerald-50 text-emerald-800':status==='Frozen'?'border-amber-300 bg-amber-50 text-amber-900':'border-slate-200 bg-slate-50 text-slate-700')}>{status}</span>
    </div>
    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
      <div><dt className="text-xs text-[hsl(var(--muted))]">Start</dt><dd className="mt-1 font-medium">{date(row.start_date)}</dd></div>
      <div><dt className="text-xs text-[hsl(var(--muted))]">End</dt><dd className="mt-1 font-medium">{date(row.end_date)}</dd></div>
      <div><dt className="text-xs text-[hsl(var(--muted))]">{sessions?'Sessions remaining':'Days remaining'}</dt>
        <dd className="mt-1 font-medium">{sessions?remaining:days!==null&&isCurrent(row,today)?Math.max(0,days):'—'}</dd></div>
      <div><dt className="text-xs text-[hsl(var(--muted))]">Recorded subscription amount</dt><dd className="mt-1 font-medium">{money(row.amount)}</dd></div>
      <div><dt className="text-xs text-[hsl(var(--muted))]">Outstanding amount</dt><dd className="mt-1 font-medium">{money(row.amount_due)}</dd></div>
      <div><dt className="text-xs text-[hsl(var(--muted))]">Payment method on record</dt><dd className="mt-1 font-medium">{row.payment_method||'—'}</dd></div>
      {sessions&&<div><dt className="text-xs text-[hsl(var(--muted))]">Sessions used / total</dt><dd className="mt-1 font-medium">{row.sessions_used??0} / {row.sessions_total??'—'}</dd></div>}
      {row.paid_at&&<div><dt className="text-xs text-[hsl(var(--muted))]">Recorded payment date</dt><dd className="mt-1 font-medium">{date(row.paid_at)}</dd></div>}
      {row.frozen_until&&<div><dt className="text-xs text-[hsl(var(--muted))]">Freeze until</dt><dd className="mt-1 font-medium">{date(row.frozen_until)}</dd></div>}
    </dl>
  </article>
}

export default async function MemberSubscriptionHistoryPage({
  params,searchParams
}:{params:{id:string};searchParams?:{page?:string|string[]}}){
  const me=await getSessionUser()
  const next='/members/'+encodeURIComponent(params.id)+'/subscriptions'
  if(!me)redirect('/login?next='+encodeURIComponent(next))
  const staff=['reception','admin','super_admin'].includes(me.role)
  const isSelf=UUID.test(params.id)&&me.id===params.id
  // Coaches and all other roles cannot inspect another member's financial/subscription history.
  if(!staff&&!isSelf)return <main className="mx-auto max-w-4xl p-6"><h1 className="text-xl font-semibold">Access denied</h1><p>Only the member or authorized administrative staff may view this page.</p></main>

  const db=staff?createSupabaseAdminClient():createSupabaseRSC()
  const {data:profile,error:profileError}=await db.from('profiles')
    .select('user_id,member_id,first_name,last_name,role,archived_at')
    .eq(UUID.test(params.id)?'user_id':'member_id',params.id).maybeSingle()
  if(profileError)throw new Error('MEMBER_PROFILE_LOOKUP_FAILED')
  if(!profile||profile.archived_at)return notFound()
  const member=profile as Member
  if(!staff&&member.user_id!==me.id)return notFound()
  const today=cairoToday()
  const rawPage=typeof searchParams?.page==='string'?Number(searchParams.page):1
  const page=Number.isSafeInteger(rawPage)&&rawPage>0?Math.min(rawPage,100000):1

  // Query current separately so a long historical record cannot hide the current plan.
  const {data:activeData,error:activeError}=await db.from('subscriptions').select(SELECT)
    .eq('member_id',member.user_id).eq('status','active')
    .order('start_date',{ascending:false}).limit(500)
  if(activeError)throw new Error('MEMBER_ACTIVE_SUBSCRIPTIONS_FAILED')
  const current=((activeData??[]) as Subscription[]).filter(row=>isCurrent(row,today))
  const currentIds=current.map(row=>row.id)
  let historyQuery=db.from('subscriptions').select(SELECT,{count:'exact'}).eq('member_id',member.user_id)
  // Server-side exclusion guarantees that current subscriptions are never listed twice.
  if(currentIds.length)historyQuery=historyQuery.not('id','in','('+currentIds.join(',')+')')
  const {data:historyData,error:historyError,count}=await historyQuery
    .order('start_date',{ascending:false,nullsFirst:false})
    .order('created_at',{ascending:false})
    .range((page-1)*PER_PAGE,page*PER_PAGE-1)
  if(historyError)throw new Error('MEMBER_SUBSCRIPTION_HISTORY_FAILED')
  const history=(historyData??[]) as Subscription[]
  const total=Number(count??0)
  const totalPages=Math.max(1,Math.ceil(total/PER_PAGE))
  const back='/members/'+encodeURIComponent(member.user_id)
  const href=(p:number)=>next+(p===1?'':'?page='+p)
  const name=[member.first_name,member.last_name].filter(Boolean).join(' ')||member.member_id||'Member'

  return <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Membership & subscription history</h1>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">{name} · {member.member_id??'No member ID'}</p>
      </div>
      <Link href={isSelf?'/profile':back} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50"><ArrowLeft size={16}/> Back to profile</Link>
    </div>
    {hasLifetimeGymAccess(member.role as Parameters<typeof hasLifetimeGymAccess>[0])&&
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">This account has lifetime access under its role. Subscription records below are shown for reference only.</div>}
    <section className="space-y-3" aria-labelledby="current-membership-title">
      <div className="flex items-center gap-2"><CreditCard size={19}/><h2 id="current-membership-title" className="text-lg font-bold">Current membership</h2><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{current.length}</span></div>
      {current.length?current.map(row=><SubscriptionCard key={row.id} row={row} today={today}/>):
        <div className="rounded-2xl border bg-white p-5 text-sm text-[hsl(var(--muted))]">No currently valid subscription recorded.</div>}
    </section>
    <section className="space-y-3" aria-labelledby="history-membership-title">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><History size={19}/><h2 id="history-membership-title" className="text-lg font-bold">Subscription history</h2><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{total}</span></div>
        <span className="text-xs text-[hsl(var(--muted))]">Newest first</span>
      </div>
      {history.length?history.map(row=><SubscriptionCard key={row.id} row={row} today={today}/>):
        <div className="rounded-2xl border bg-white p-5 text-sm text-[hsl(var(--muted))]">{total===0?'No previous subscriptions.':'No subscriptions on this page.'}</div>}
      {totalPages>1&&<nav aria-label="Subscription history pages" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
        <span className="text-sm">Page {page} of {totalPages} · {total} historical record(s)</span>
        <div className="flex gap-2">
          {page>1?<Link className="rounded-lg border px-3 py-2 text-sm font-medium" href={href(page-1)}>Previous</Link>:null}
          {page<totalPages?<Link className="rounded-lg border px-3 py-2 text-sm font-medium" href={href(page+1)}>Next</Link>:null}
        </div>
      </nav>}
    </section>
    <div className="flex items-start gap-2 rounded-xl border bg-slate-50 p-3 text-xs text-slate-600">
      <Wallet size={17} className="shrink-0"/>
      <p>Subscription amount and outstanding amount reflect the stored membership record, not a complete payment ledger. For payment allocations, corrections or refunds, use the existing authorized finance tools. This page is read-only.</p>
    </div>
  </main>
}
