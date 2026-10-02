export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import Button from '@/components/ui/Button'
import BankOutflowMatcher, {
  type OutflowMatch,
  type OutflowSource,
} from '@/components/admin/banking/BankOutflowMatcher'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'

type DebitRow = {
  id: string
  transaction_date: string
  description: string
  reference: string | null
  counterparty: string | null
  amount: number | string
  currency: string
  category_code: string | null
  classification_status: string
}

function first(value:string|string[]|undefined){return Array.isArray(value)?value[0]:value}
function safeDate(value:unknown){const t=String(value??'').trim();return /^\d{4}-\d{2}-\d{2}$/.test(t)?t:''}
function cairoToday(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date())
  const y=parts.find(p=>p.type==='year')?.value??''
  const m=parts.find(p=>p.type==='month')?.value??''
  const d=parts.find(p=>p.type==='day')?.value??''
  return `${y}-${m}-${d}`
}
function monthStart(today:string){const [y,m]=today.split('-');return `${y}-${m}-01`}
function fmtMoney(value:unknown,currency='EGP'){
  const n=Number(value??0)
  try{return new Intl.NumberFormat('en-EG',{style:'currency',currency,maximumFractionDigits:2}).format(n)}
  catch{return `${n.toFixed(2)} ${currency}`}
}
function fmtDate(value:string|null){if(!value)return'—';const d=new Date(`${value}T12:00:00Z`);return Number.isNaN(d.getTime())?value:new Intl.DateTimeFormat('en-GB',{dateStyle:'medium'}).format(d)}

export default async function BankingOutflowsPage({
  searchParams,
}:{
  searchParams?:Record<string,string|string[]|undefined>
}) {
  const me=await getSessionUserCached()
  if(!me)redirect('/login?next=/admin/banking/outflows')

  if(me.role!=='super_admin'){
    return <main className="p-6">
      <h1 className="text-2xl font-bold">Banking · Outflow Reconciliation</h1>
      <div className="mt-4 max-w-2xl">
        <AccessDeniedCard title="Forbidden" message="Only Super Admin can reconcile bank outflows." nextPath="/admin/banking/outflows" showBackHome signedInAs={me.email}/>
      </div>
    </main>
  }

  const today=cairoToday()
  const from=safeDate(first(searchParams?.from))||monthStart(today)
  const to=safeDate(first(searchParams?.to))||today
  const statusFilter=String(first(searchParams?.status)??'all')
  const q=String(first(searchParams?.q)??'').trim().toLowerCase()
  const admin=getSupabaseAdminClientCached() as any

  const [
    debitsResult,
    matchesResult,
    expensesResult,
    payrollResult,
    refundsResult,
    categoriesResult,
  ]=await Promise.all([
    admin.from('bank_transactions')
      .select('id,transaction_date,description,reference,counterparty,amount,currency,category_code,classification_status')
      .eq('direction','debit').gte('transaction_date',from).lte('transaction_date',to)
      .order('transaction_date',{ascending:false}).limit(2000),
    admin.from('bank_outflow_matches')
      .select('id,bank_transaction_id,source_kind,source_id,matched_amount,note,matched_at')
      .is('released_at',null).order('matched_at',{ascending:false}),
    admin.from('expenses')
      .select('id,date,category_key,description,amount,payment_method')
      .gte('date',from).lte('date',to)
      .order('date',{ascending:false}).limit(3000),
    admin.from('staff_payroll_salary_payments')
      .select('id,payment_date,staff_name_snapshot,amount,payment_method,reference,status')
      .eq('status','active').gte('payment_date',from).lte('payment_date',to)
      .order('payment_date',{ascending:false}).limit(2000),
    admin.from('membership_refunds')
      .select('id,amount,refund_method,status,paid_at,refunded_at,reason')
      .eq('status','paid').gte('paid_at',`${from}T00:00:00`).lte('paid_at',`${to}T23:59:59`)
      .order('paid_at',{ascending:false}).limit(2000),
    admin.from('expense_categories')
      .select('key,label').eq('is_active',true),
  ])

  const loadError=
    debitsResult.error?.message||
    matchesResult.error?.message||
    expensesResult.error?.message||
    payrollResult.error?.message||
    refundsResult.error?.message||
    categoriesResult.error?.message||null

  const categoryLabel=new Map((categoriesResult.data??[]).map((r:any)=>[String(r.key),String(r.label)]))
  const matches=(matchesResult.data??[]).map((r:any)=>({
    id:String(r.id),
    bank_transaction_id:String(r.bank_transaction_id),
    source_kind:r.source_kind,
    source_id:String(r.source_id),
    matched_amount:Number(r.matched_amount??0),
    note:r.note??null,
    matched_at:String(r.matched_at),
  })) as OutflowMatch[]

  const matchedBySource=new Map<string,number>()
  const matchesByTransaction=new Map<string,OutflowMatch[]>()
  for(const m of matches){
    const key=`${m.source_kind}:${m.source_id}`
    matchedBySource.set(key,(matchedBySource.get(key)??0)+m.matched_amount)
    const current=matchesByTransaction.get(m.bank_transaction_id)??[]
    current.push(m);matchesByTransaction.set(m.bank_transaction_id,current)
  }

  const sources:OutflowSource[]=[
    ...(expensesResult.data??[]).map((r:any)=>({
      kind:'expense' as const,
      id:String(r.id),
      date:String(r.date),
      label:String(r.description||categoryLabel.get(String(r.category_key))||'Expense'),
      sublabel:`${categoryLabel.get(String(r.category_key))||r.category_key} · ${String(r.payment_method||'—').replaceAll('_',' ')}`,
      amount:Number(r.amount??0),
      payment_method:r.payment_method??null,
      active_matched_amount:matchedBySource.get(`expense:${r.id}`)??0,
    })),
    ...(payrollResult.data??[]).map((r:any)=>({
      kind:'staff_payroll_payment' as const,
      id:String(r.id),
      date:String(r.payment_date),
      label:`Payroll · ${String(r.staff_name_snapshot||'Staff')}`,
      sublabel:`${String(r.payment_method||'—').replaceAll('_',' ')}${r.reference?` · Ref ${r.reference}`:''}`,
      amount:Number(r.amount??0),
      payment_method:r.payment_method??null,
      active_matched_amount:matchedBySource.get(`staff_payroll_payment:${r.id}`)??0,
    })),
    ...(refundsResult.data??[]).map((r:any)=>({
      kind:'membership_refund' as const,
      id:String(r.id),
      date:String(r.paid_at||r.refunded_at||'').slice(0,10),
      label:'Membership refund',
      sublabel:`${String(r.refund_method||'—').replaceAll('_',' ')}${r.reason?` · ${String(r.reason).slice(0,80)}`:''}`,
      amount:Number(r.amount??0),
      payment_method:r.refund_method??null,
      active_matched_amount:matchedBySource.get(`membership_refund:${r.id}`)??0,
    })),
  ].filter(s=>Boolean(s.date)&&s.amount>0)

  const debits=(debitsResult.data??[]) as DebitRow[]

  function progress(row:DebitRow):{matched:number;remaining:number;status:'unmatched'|'partial'|'matched'}{
    const active=matchesByTransaction.get(row.id)??[]
    const matched=active.reduce((s,m)=>s+m.matched_amount,0)
    const amount=Number(row.amount??0)
    const remaining=Math.max(0,amount-matched)
    const status:'unmatched'|'partial'|'matched'=matched<=0.009?'unmatched':remaining<=0.009?'matched':'partial'
    return {matched,remaining,status}
  }

  const visible=debits.filter(row=>{
    if(q){
      const hay=[row.description,row.reference,row.counterparty,row.amount].filter(Boolean).join(' ').toLowerCase()
      if(!hay.includes(q))return false
    }
    const state=progress(row).status
    if(['unmatched','partial','matched'].includes(statusFilter))return state===statusFilter
    return true
  })

  const stats=debits.reduce((acc,row)=>{
    const p=progress(row)
    acc[p.status]+=1
    acc.total+=Number(row.amount??0)
    acc.matchedAmount+=p.matched
    return acc
  },{unmatched:0,partial:0,matched:0,total:0,matchedAmount:0})

  return <main className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold">Banking · Outflow Reconciliation</h1>
        <p className="mt-1 max-w-3xl text-sm text-[hsl(var(--muted))]">
          Match real bank debits to existing ATOM expenses, staff payroll payments and paid membership refunds.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" href="/admin/banking">Bank feed</Button>
        <Button asChild variant="outline" href="/admin/banking/reconciliation">Income reconciliation</Button>
        <Button asChild variant="outline" href="/expenses">Expenses</Button>
      </div>
    </div>

    {loadError?<div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">Could not load outflow reconciliation data: {loadError}</div>:null}

    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Link href={`/admin/banking/outflows?from=${from}&to=${to}&status=unmatched`} className="rounded-2xl border bg-white p-4 shadow-soft">
        <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Unmatched</p><p className="mt-1 text-2xl font-bold">{stats.unmatched}</p>
      </Link>
      <Link href={`/admin/banking/outflows?from=${from}&to=${to}&status=partial`} className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-soft">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Partial</p><p className="mt-1 text-2xl font-bold text-amber-900">{stats.partial}</p>
      </Link>
      <Link href={`/admin/banking/outflows?from=${from}&to=${to}&status=matched`} className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-soft">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Matched</p><p className="mt-1 text-2xl font-bold text-emerald-900">{stats.matched}</p>
      </Link>
      <div className="rounded-2xl border bg-white p-4 shadow-soft">
        <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Matched value</p>
        <p className="mt-1 text-xl font-bold">{fmtMoney(stats.matchedAmount)}</p>
        <p className="mt-1 text-xs text-[hsl(var(--muted))]">of {fmtMoney(stats.total)} bank debits</p>
      </div>
    </section>

    <section className="rounded-2xl border bg-white p-4 shadow-soft">
      <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_180px_180px_180px_auto] xl:items-end">
        <label className="space-y-1 text-sm"><span className="font-medium">Search</span><input name="q" defaultValue={String(first(searchParams?.q)??'')} placeholder="Description, reference, counterparty…" className="w-full rounded-xl border px-3 py-2.5"/></label>
        <label className="space-y-1 text-sm"><span className="font-medium">From</span><input type="date" name="from" defaultValue={from} className="w-full rounded-xl border px-3 py-2.5"/></label>
        <label className="space-y-1 text-sm"><span className="font-medium">To</span><input type="date" name="to" defaultValue={to} className="w-full rounded-xl border px-3 py-2.5"/></label>
        <label className="space-y-1 text-sm"><span className="font-medium">Status</span><select name="status" defaultValue={statusFilter} className="w-full rounded-xl border px-3 py-2.5"><option value="all">All</option><option value="unmatched">Unmatched</option><option value="partial">Partial</option><option value="matched">Matched</option></select></label>
        <div className="flex gap-2"><Button type="submit">Apply</Button><Button asChild variant="outline" href="/admin/banking/outflows">Reset</Button></div>
      </form>
    </section>

    <section className="space-y-3">
      {visible.slice(0,250).map(row=>{
        const p=progress(row)
        const active=matchesByTransaction.get(row.id)??[]
        return <article key={row.id} className="rounded-2xl border bg-white p-4 shadow-soft">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${p.status==='matched'?'border-emerald-200 bg-emerald-50 text-emerald-800':p.status==='partial'?'border-amber-200 bg-amber-50 text-amber-800':'border-slate-200 bg-slate-50 text-slate-700'}`}>{p.status==='matched'?'Matched':p.status==='partial'?'Partial':'Unmatched'}</span>
                <span className="text-sm font-semibold">{fmtDate(row.transaction_date)}</span>
                {row.category_code?<span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800">{row.category_code.replaceAll('_',' ')}</span>:null}
              </div>
              <p className="mt-1 font-semibold">{row.description}</p>
              <p className="mt-1 text-xs text-[hsl(var(--muted))]">{row.counterparty?`Counterparty: ${row.counterparty}`:''}{row.counterparty&&row.reference?' · ':''}{row.reference?`Ref: ${row.reference}`:''}</p>
            </div>
            <div className="shrink-0 text-left md:text-right">
              <p className="text-lg font-bold text-rose-700">-{fmtMoney(row.amount,row.currency)}</p>
              <p className="text-xs text-[hsl(var(--muted))]">Matched {fmtMoney(p.matched)} · Remaining {fmtMoney(p.remaining)}</p>
            </div>
          </div>
          <BankOutflowMatcher transactionId={row.id} transactionDate={row.transaction_date} transactionAmount={Number(row.amount??0)} activeMatches={active} sources={sources}/>
        </article>
      })}
      {!visible.length?<div className="rounded-2xl border border-dashed bg-white p-10 text-center text-sm text-[hsl(var(--muted))]">No bank debits match the current filters.</div>:null}
      {visible.length>250?<p className="text-xs text-[hsl(var(--muted))]">Showing first 250 results. Narrow the date range or status to continue.</p>:null}
    </section>

    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
      Outflow reconciliation never creates, edits or deletes an Expense, Payroll payment or Membership Refund. It only links existing records to bank debits.
    </div>
  </main>
}
