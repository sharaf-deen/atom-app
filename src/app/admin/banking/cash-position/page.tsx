export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import Button from '@/components/ui/Button'
import CashCommitmentsManager, { type CashCommitment } from '@/components/admin/banking/CashCommitmentsManager'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'

type BankAccount = {
  id:string
  display_name:string
  currency:string
}

function fmtMoney(value:unknown,currency='EGP'){
  const n=Number(value??0)
  if(!Number.isFinite(n))return'—'
  try{return new Intl.NumberFormat('en-EG',{style:'currency',currency,maximumFractionDigits:2}).format(n)}
  catch{return `${n.toFixed(2)} ${currency}`}
}
function fmtDate(value?:string|null){
  if(!value)return'—'
  const raw=String(value).slice(0,10)
  const d=new Date(`${raw}T12:00:00Z`)
  return Number.isNaN(d.getTime())?raw:new Intl.DateTimeFormat('en-GB',{dateStyle:'medium'}).format(d)
}
function cairoToday(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date())
  const y=parts.find(p=>p.type==='year')?.value??''
  const m=parts.find(p=>p.type==='month')?.value??''
  const d=parts.find(p=>p.type==='day')?.value??''
  return `${y}-${m}-${d}`
}
function addDays(date:string,days:number){
  const d=new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate()+days)
  return d.toISOString().slice(0,10)
}

export default async function BankingCashPositionPage(){
  const me=await getSessionUserCached()
  if(!me)redirect('/login?next=/admin/banking/cash-position')

  if(me.role!=='super_admin'){
    return <main className="p-6">
      <h1 className="text-2xl font-bold">Banking · Cash Position</h1>
      <div className="mt-4 max-w-2xl">
        <AccessDeniedCard title="Forbidden" message="Only Super Admin can access ATOM cash position." nextPath="/admin/banking/cash-position" showBackHome signedInAs={me.email}/>
      </div>
    </main>
  }

  const admin=getSupabaseAdminClientCached() as any
  const today=cairoToday()
  const next7=addDays(today,7)
  const next30=addDays(today,30)

  const [
    accountsResult,
    commitmentsResult,
    snapshotsResult,
    refundsResult,
  ]=await Promise.all([
    admin.from('bank_accounts')
      .select('id,display_name,currency')
      .eq('is_active',true)
      .order('display_name',{ascending:true}),
    admin.from('bank_cash_commitments')
      .select('id,label,category_code,amount,due_date,note,status')
      .eq('status','open')
      .order('due_date',{ascending:true})
      .order('created_at',{ascending:true}),
    admin.from('staff_payroll_monthly_snapshots')
      .select('id,month_start,status,approval_version_no')
      .eq('status','approved')
      .order('month_start',{ascending:false})
      .limit(36),
    admin.from('membership_refunds')
      .select('id,member_id,amount,status,approved_at,reason')
      .eq('status','approved')
      .order('approved_at',{ascending:true})
      .limit(1000),
  ])

  const accounts=(accountsResult.data??[]) as BankAccount[]
  const commitments=(commitmentsResult.data??[]).map((r:any)=>({
    id:String(r.id),
    label:String(r.label),
    category_code:String(r.category_code),
    amount:Number(r.amount??0),
    due_date:String(r.due_date),
    note:r.note??null,
    status:String(r.status),
  })) as CashCommitment[]

  const balanceResults=await Promise.all(accounts.map(async account=>{
    const { data,error }=await admin.from('bank_transactions')
      .select('running_balance,transaction_date,source_row')
      .eq('account_id',account.id)
      .not('running_balance','is',null)
      .order('transaction_date',{ascending:false})
      .order('source_row',{ascending:false,nullsFirst:false})
      .limit(1)
    return { account, row:data?.[0]??null, error }
  }))

  let reportedBalance=0
  let accountsWithBalance=0
  for(const result of balanceResults){
    if(result.row?.running_balance!==null&&result.row?.running_balance!==undefined){
      reportedBalance+=Number(result.row.running_balance??0)
      accountsWithBalance+=1
    }
  }
  const allAccountsReported=accounts.length>0&&accountsWithBalance===accounts.length

  const snapshots=(snapshotsResult.data??[]) as any[]
  const snapshotIds=snapshots.map(r=>String(r.id))
  const { data:versionsRaw,error:versionsError }=snapshotIds.length
    ? await admin.from('staff_payroll_approval_versions')
        .select('id,snapshot_id,version_no,month_start')
        .in('snapshot_id',snapshotIds)
    : {data:[],error:null as any}

  const snapshotVersionKey=new Set(snapshots.map(r=>`${String(r.id)}:${Number(r.approval_version_no)}`))
  const currentVersions=(versionsRaw??[]).filter((r:any)=>snapshotVersionKey.has(`${String(r.snapshot_id)}:${Number(r.version_no)}`))
  const versionIds=currentVersions.map((r:any)=>String(r.id))

  const { data:calculationsRaw,error:calculationsError }=versionIds.length
    ? await admin.from('staff_payroll_approval_calculations')
        .select('id,approval_version_id,month_start,staff_user_id,staff_name_snapshot,calculated_salary')
        .in('approval_version_id',versionIds)
    : {data:[],error:null as any}

  const calcIds=(calculationsRaw??[]).map((r:any)=>String(r.id))
  const { data:paymentsRaw,error:paymentsError }=calcIds.length
    ? await admin.from('staff_payroll_salary_payments')
        .select('approval_calculation_id,amount,status')
        .in('approval_calculation_id',calcIds)
        .eq('status','active')
    : {data:[],error:null as any}

  const paidByCalc=new Map<string,number>()
  for(const row of paymentsRaw??[]){
    const id=String((row as any).approval_calculation_id)
    paidByCalc.set(id,(paidByCalc.get(id)??0)+Number((row as any).amount??0))
  }

  const unpaidPayroll=(calculationsRaw??[]).map((r:any)=>{
    const salary=Math.max(0,Number(r.calculated_salary??0))
    const paid=paidByCalc.get(String(r.id))??0
    const remaining=Math.max(0,salary-paid)
    return {
      id:String(r.id),
      staffName:String(r.staff_name_snapshot||'Staff'),
      monthStart:String(r.month_start),
      salary,
      paid,
      remaining,
    }
  }).filter((r:any)=>r.remaining>0.009)

  const payrollCommitted=unpaidPayroll.reduce((s:number,r:any)=>s+r.remaining,0)
  const refundRows=(refundsResult.data??[]) as any[]
  const refundsCommitted=refundRows.reduce((s:number,r:any)=>s+Number(r.amount??0),0)
  const manualCommitted=commitments.reduce((s,r)=>s+r.amount,0)
  const committedCash=payrollCommitted+refundsCommitted+manualCommitted
  const availableCash=reportedBalance-committedCash

  const overdueManual=commitments.filter(c=>c.due_date<today).reduce((s,c)=>s+c.amount,0)
  const next7Manual=commitments.filter(c=>c.due_date>=today&&c.due_date<=next7).reduce((s,c)=>s+c.amount,0)
  const next30Manual=commitments.filter(c=>c.due_date>next7&&c.due_date<=next30).reduce((s,c)=>s+c.amount,0)

  const loadError=[
    accountsResult.error?.message,
    commitmentsResult.error?.message,
    snapshotsResult.error?.message,
    refundsResult.error?.message,
    versionsError?.message,
    calculationsError?.message,
    paymentsError?.message,
    ...balanceResults.map(r=>r.error?.message),
  ].filter(Boolean).join(' · ')||null

  return <main className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold">Banking · Cash Position</h1>
        <p className="mt-1 max-w-3xl text-sm text-[hsl(var(--muted))]">
          Separate reported bank cash from committed obligations to see what ATOM can actually use.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" href="/admin/banking">Bank feed</Button>
        <Button asChild variant="outline" href="/admin/banking/reconciliation">Income reconciliation</Button>
        <Button asChild variant="outline" href="/admin/banking/outflows">Outflow reconciliation</Button>
      </div>
    </div>

    {loadError?<div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">Could not fully calculate cash position: {loadError}</div>:null}

    {!allAccountsReported?<div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <strong>Bank balance incomplete.</strong> {accountsWithBalance} of {accounts.length} active bank account(s) have a reported running balance. Import a statement containing a Balance column before relying on Available Cash.
    </div>:null}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-2xl border bg-white p-4 shadow-soft">
        <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Bank balance</p>
        <p className="mt-2 text-2xl font-bold">{accountsWithBalance?fmtMoney(reportedBalance):'—'}</p>
        <p className="mt-1 text-xs text-[hsl(var(--muted))]">Latest reported balances across active accounts</p>
      </div>
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-soft">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Committed cash</p>
        <p className="mt-2 text-2xl font-bold text-amber-900">{fmtMoney(committedCash)}</p>
        <p className="mt-1 text-xs text-amber-800">Payroll + approved refunds + manual commitments</p>
      </div>
      <div className={`rounded-2xl border p-4 shadow-soft ${availableCash>=0?'border-emerald-200 bg-emerald-50':'border-rose-200 bg-rose-50'}`}>
        <p className={`text-xs font-semibold uppercase tracking-wide ${availableCash>=0?'text-emerald-800':'text-rose-800'}`}>Available cash</p>
        <p className={`mt-2 text-2xl font-bold ${availableCash>=0?'text-emerald-900':'text-rose-900'}`}>{accountsWithBalance?fmtMoney(availableCash):'—'}</p>
        <p className={`mt-1 text-xs ${availableCash>=0?'text-emerald-800':'text-rose-800'}`}>Bank balance − committed cash</p>
      </div>
      <div className="rounded-2xl border bg-white p-4 shadow-soft">
        <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Commitment load</p>
        <p className="mt-2 text-2xl font-bold">{reportedBalance>0?`${Math.round((committedCash/reportedBalance)*100)}%`:'—'}</p>
        <p className="mt-1 text-xs text-[hsl(var(--muted))]">Share of reported bank balance already committed</p>
      </div>
    </section>

    <section className="grid gap-3 md:grid-cols-3">
      <div className="rounded-2xl border bg-white p-4 shadow-soft">
        <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Approved payroll unpaid</p>
        <p className="mt-1 text-xl font-bold">{fmtMoney(payrollCommitted)}</p>
        <p className="mt-1 text-xs text-[hsl(var(--muted))]">{unpaidPayroll.length} staff payment balance(s)</p>
      </div>
      <div className="rounded-2xl border bg-white p-4 shadow-soft">
        <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Approved refunds unpaid</p>
        <p className="mt-1 text-xl font-bold">{fmtMoney(refundsCommitted)}</p>
        <p className="mt-1 text-xs text-[hsl(var(--muted))]">{refundRows.length} approved refund(s)</p>
      </div>
      <div className="rounded-2xl border bg-white p-4 shadow-soft">
        <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Manual commitments</p>
        <p className="mt-1 text-xl font-bold">{fmtMoney(manualCommitted)}</p>
        <p className="mt-1 text-xs text-[hsl(var(--muted))]">{commitments.length} open commitment(s)</p>
      </div>
    </section>

    <section className="grid gap-3 md:grid-cols-3">
      <div className={`rounded-2xl border p-4 shadow-soft ${overdueManual>0?'border-rose-200 bg-rose-50':'bg-white'}`}>
        <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Manual overdue</p>
        <p className="mt-1 text-xl font-bold">{fmtMoney(overdueManual)}</p>
      </div>
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-soft">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Manual due next 7 days</p>
        <p className="mt-1 text-xl font-bold text-amber-900">{fmtMoney(next7Manual)}</p>
      </div>
      <div className="rounded-2xl border bg-white p-4 shadow-soft">
        <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Manual due days 8–30</p>
        <p className="mt-1 text-xl font-bold">{fmtMoney(next30Manual)}</p>
      </div>
    </section>

    <section className="grid gap-4 xl:grid-cols-2">
      <div className="rounded-2xl border bg-white p-4 shadow-soft">
        <h2 className="font-semibold">Derived commitments</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">Automatically calculated from approved ATOM workflows.</p>

        <div className="mt-4 space-y-2">
          {unpaidPayroll.map((row:any)=><div key={row.id} className="rounded-xl border p-3">
            <div className="flex justify-between gap-3">
              <div><p className="font-semibold">{row.staffName}</p><p className="text-xs text-[hsl(var(--muted))]">Payroll · {fmtDate(row.monthStart)} · salary {fmtMoney(row.salary)} · already paid {fmtMoney(row.paid)}</p></div>
              <p className="font-bold">{fmtMoney(row.remaining)}</p>
            </div>
          </div>)}

          {refundRows.map((row:any)=><div key={String(row.id)} className="rounded-xl border p-3">
            <div className="flex justify-between gap-3">
              <div><p className="font-semibold">Approved membership refund</p><p className="text-xs text-[hsl(var(--muted))]">{fmtDate(row.approved_at)}{row.reason?` · ${String(row.reason).slice(0,100)}`:''}</p></div>
              <p className="font-bold">{fmtMoney(row.amount)}</p>
            </div>
          </div>)}

          {!unpaidPayroll.length&&!refundRows.length?<p className="text-sm text-[hsl(var(--muted))]">No derived unpaid commitments.</p>:null}
        </div>
      </div>

      <div className="rounded-2xl border bg-slate-50 p-4">
        <h2 className="font-semibold">How Available Cash is calculated</h2>
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between"><span>Reported bank balance</span><strong>{accountsWithBalance?fmtMoney(reportedBalance):'Unavailable'}</strong></div>
          <div className="flex justify-between text-amber-800"><span>Approved payroll unpaid</span><strong>- {fmtMoney(payrollCommitted)}</strong></div>
          <div className="flex justify-between text-amber-800"><span>Approved refunds unpaid</span><strong>- {fmtMoney(refundsCommitted)}</strong></div>
          <div className="flex justify-between text-amber-800"><span>Manual open commitments</span><strong>- {fmtMoney(manualCommitted)}</strong></div>
          <div className="border-t pt-2 flex justify-between text-base"><span className="font-semibold">Available cash</span><strong>{accountsWithBalance?fmtMoney(availableCash):'Unavailable'}</strong></div>
        </div>
        <p className="mt-4 text-xs text-[hsl(var(--muted))]">This is a management cash view, not an accounting balance sheet. Expenses already paid are represented in the bank balance and are not deducted again.</p>
      </div>
    </section>

    <CashCommitmentsManager commitments={commitments}/>

    <p className="text-xs text-[hsl(var(--muted))]">
      Manual commitments are planning records only. Marking one settled does not create an Expense or a bank transaction. Use Outflow Reconciliation after the real payment appears in the bank feed.
    </p>
  </main>
}
