export const dynamic = 'force-dynamic'
export const revalidate = 0

import { redirect } from 'next/navigation'
import AccessDeniedCard from '@/components/AccessDeniedCard'
import Button from '@/components/ui/Button'
import SmartRulesManager, { type SmartRule } from '@/components/admin/banking/SmartRulesManager'
import type { BankCategory } from '@/components/admin/banking/BankTransactionClassifier'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'

export default async function BankingSmartRulesPage() {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/banking/classification-rules')

  if (me.role !== 'super_admin') {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">Banking · Smart Rules</h1>
        <div className="mt-4 max-w-2xl">
          <AccessDeniedCard
            title="Forbidden"
            message="Only Super Admin can manage Banking classification rules."
            nextPath="/admin/banking/classification-rules"
            showBackHome
            signedInAs={me.email}
          />
        </div>
      </main>
    )
  }

  const admin = getSupabaseAdminClientCached() as any
  const [rulesResult, categoriesResult, suggestedResult] = await Promise.all([
    admin.from('bank_classification_rules')
      .select('id,name,category_code,direction_scope,match_field,pattern,priority,confidence_score,amount_min,amount_max,rule_origin,is_active,use_count,last_used_at')
      .order('is_active',{ascending:false})
      .order('confidence_score',{ascending:false})
      .order('priority',{ascending:true}),
    admin.from('bank_categories')
      .select('code,label,direction_scope')
      .eq('is_active',true)
      .order('sort_order',{ascending:true}),
    admin.from('bank_transactions')
      .select('classification_rule_id')
      .eq('classification_status','suggested')
      .not('classification_rule_id','is',null)
      .limit(5000),
  ])

  const countByRule = new Map<string,number>()
  for (const row of suggestedResult.data ?? []) {
    const id = String((row as any).classification_rule_id)
    countByRule.set(id,(countByRule.get(id)??0)+1)
  }

  const rules = (rulesResult.data ?? []).map((row:any)=>({
    id:String(row.id),
    name:String(row.name),
    category_code:String(row.category_code),
    direction_scope:row.direction_scope,
    match_field:row.match_field,
    pattern:String(row.pattern),
    priority:Number(row.priority??100),
    confidence_score:Number(row.confidence_score??0.75),
    amount_min:row.amount_min==null?null:Number(row.amount_min),
    amount_max:row.amount_max==null?null:Number(row.amount_max),
    rule_origin:row.rule_origin,
    is_active:Boolean(row.is_active),
    use_count:Number(row.use_count??0),
    last_used_at:row.last_used_at??null,
    suggested_count:countByRule.get(String(row.id))??0,
  })) as SmartRule[]

  const categories=(categoriesResult.data??[]) as BankCategory[]
  const active=rules.filter(r=>r.is_active).length
  const learned=rules.filter(r=>r.rule_origin==='manual_learning').length
  const cib=rules.filter(r=>r.rule_origin==='cib_seed').length
  const currentSuggestions=rules.reduce((s,r)=>s+r.suggested_count,0)

  const loadError=rulesResult.error?.message||categoriesResult.error?.message||suggestedResult.error?.message||null

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Banking · Smart Recognition Rules</h1>
          <p className="mt-1 max-w-3xl text-sm text-[hsl(var(--muted))]">
            Review the transparent rules behind Banking suggestions. Rules can suggest classifications, but they never silently confirm a bank transaction.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" href="/admin/banking">Bank feed</Button>
          <Button asChild variant="outline" href="/admin/banking/reconciliation">Income reconciliation</Button>
          <Button asChild variant="outline" href="/admin/banking/outflows">Outflow reconciliation</Button>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Could not fully load Smart Rules: {loadError}
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border bg-white p-4 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Active rules</p>
          <p className="mt-1 text-2xl font-bold">{active}</p>
        </div>
        <div className="rounded-2xl border bg-white p-4 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">CIB rules</p>
          <p className="mt-1 text-2xl font-bold">{cib}</p>
        </div>
        <div className="rounded-2xl border bg-white p-4 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Learned rules</p>
          <p className="mt-1 text-2xl font-bold">{learned}</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Suggestions awaiting review</p>
          <p className="mt-1 text-2xl font-bold text-amber-900">{currentSuggestions}</p>
        </div>
      </section>

      <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
        <strong>How learning works:</strong> after you choose the correct category on a bank transaction, “Learn from this” creates a narrow rule from a stable payer, beneficiary, merchant or transaction signature. Similar rows become Suggested only. You remain the final confirmer.
      </div>

      <SmartRulesManager rules={rules} categories={categories}/>

      <p className="text-xs text-[hsl(var(--muted))]">
        Disable a rule if it becomes noisy. Editing a rule changes future suggestions; it does not rewrite transactions already confirmed.
      </p>
    </main>
  )
}
