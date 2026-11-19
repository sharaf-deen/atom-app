import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { cairoToday } from '@/lib/cairoDate'
import { isSellableMembershipPlan, type SellableMembershipPlan } from '@/lib/membershipPlans'

export type RenewalPaymentMethod = 'instapay' | 'bank_transfer' | 'card' | 'cash'
export const RENEWAL_METHODS: RenewalPaymentMethod[] = ['instapay','bank_transfer','card','cash']

const DURATION: Record<SellableMembershipPlan, {unit:'week'|'month';qty:number}> = {
  '1w': {unit:'week',qty:1},
  '1m': {unit:'month',qty:1},
  '3m': {unit:'month',qty:3},
  '6m': {unit:'month',qty:6},
  '12m': {unit:'month',qty:12},
}
function money(n:number) { return Math.round((n + Number.EPSILON)*100)/100 }

export async function renewalQuote(plan: string) {
  if (!isSellableMembershipPlan(plan)) throw new Error('INVALID_PLAN')
  const admin = createSupabaseAdminClient()
  const key = DURATION[plan]
  const {data: packages,error} = await admin.from('packages_pricing')
    .select('id,name,price_egp').eq('type','membership').eq('unit',key.unit)
    .eq('qty',key.qty).eq('is_active',true).limit(2)
  if (error) throw error
  if (!packages || packages.length !== 1) throw new Error('PACKAGE_PRICE_UNAVAILABLE')
  const pkg = packages[0]
  const catalog = Number(pkg.price_egp)
  if (!Number.isFinite(catalog) || catalog < 0) throw new Error('INVALID_CATALOG_PRICE')
  const today = cairoToday()
  const {data:promos,error:promoErr} = await admin.from('promotions')
    .select('id,title,discount_type,discount_value,applies_to,min_months,start_date,end_date')
    .contains('applies_to',['membership'])
    .or(`start_date.is.null,start_date.lte.${today}`)
    .or(`end_date.is.null,end_date.gte.${today}`)
  if (promoErr) throw promoErr
  const candidates = (promos||[]).filter((p:any) =>
    (!p.min_months || (key.unit==='month' && key.qty>=Number(p.min_months)))
  ).map((p:any) => {
    const value = Number(p.discount_value)
    if (!Number.isFinite(value) || value<=0 || (p.discount_type==='percent' && value>100)) return null
    const discount = p.discount_type==='percent' ? catalog*value/100 : value
    return {id:p.id,title:p.title,discount_egp:money(Math.min(catalog,discount)),type:p.discount_type,value}
  }).filter(Boolean) as Array<{id:string;title:string;discount_egp:number;type:string;value:number}>
  candidates.sort((a,b)=>b.discount_egp-a.discount_egp)
  const best = candidates[0] ?? null
  const quote = money(Math.max(0,catalog-(best?.discount_egp||0)))
  return {
    plan,package_id:pkg.id,package_name:pkg.name,catalog_price_egp:catalog,
    quoted_price_egp:quote,promotion:best,quoted_at:new Date().toISOString(),
    pricing_snapshot:{package_id:pkg.id,package_name:pkg.name,catalog_price_egp:catalog,
      promotion:best,quote,eligibility_checked_at:today,discount_stacking:'none',
      note:'Indicative only; family/individual discounts require Super Admin approval'},
  }
}
