export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

function json(body: unknown, status = 200) {
  const r = NextResponse.json(body, { status })
  r.headers.set('Cache-Control', 'no-store')
  return r
}
function isUuid(v: unknown) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
}
function clean(v: unknown, max: number) {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}
function esc(v: string) {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
function combined(tx: any) {
  return [tx.description, tx.counterparty, tx.reference].filter(Boolean).join(' ').toLowerCase()
}
function fieldText(tx: any, field: string) {
  if (field === 'description') return String(tx.description ?? '').toLowerCase()
  if (field === 'counterparty') return String(tx.counterparty ?? '').toLowerCase()
  if (field === 'reference') return String(tx.reference ?? '').toLowerCase()
  return combined(tx)
}
function regexMatch(text: string, pattern: string) {
  try { return new RegExp(pattern, 'i').test(text) }
  catch { return text.includes(pattern.toLowerCase()) }
}
function amountMatch(amount: number, min: unknown, max: unknown) {
  const lo = min == null ? null : Number(min)
  const hi = max == null ? null : Number(max)
  if (lo != null && Number.isFinite(lo) && amount < lo - 0.009) return false
  if (hi != null && Number.isFinite(hi) && amount > hi + 0.009) return false
  return true
}
function matches(tx: any, rule: any) {
  if (rule.direction_scope !== 'both' && rule.direction_scope !== tx.direction) return false
  if (!amountMatch(Number(tx.amount ?? 0), rule.amount_min, rule.amount_max)) return false
  return regexMatch(fieldText(tx, rule.match_field), String(rule.pattern ?? ''))
}
function bestRule(tx: any, rules: any[]) {
  return rules.filter(r => matches(tx, r)).sort((a,b) => {
    const c = Number(b.confidence_score ?? 0) - Number(a.confidence_score ?? 0)
    return Math.abs(c) > 0.0001 ? c : Number(a.priority ?? 100) - Number(b.priority ?? 100)
  })[0] ?? null
}
function band(score: number) {
  return score >= 0.9 ? 'high' : score >= 0.75 ? 'medium' : 'low'
}
function learnedPattern(tx: any) {
  const d = String(tx.description ?? '').replace(/\s+/g,' ').trim()

  const phone = d.match(/PayerMobNo:\s*([0-9 ]{8,20})/i)
  if (phone) {
    const digits = phone[1].replace(/\D/g,'')
    if (digits.length >= 8) {
      const spacedDigits = digits.split('').map(esc).join('\\s*')
      return { field:'description', pattern:`PayerMobNo:\\s*${spacedDigits}`, label:`payer ${digits.slice(-4)}` }
    }
  }

  const beneficiary = d.match(/BenefAcct:\s*([^\s]+)/i)
  if (beneficiary?.[1]) {
    const token = beneficiary[1].trim()
    return { field:'description', pattern:`BenefAcct:\\s*${esc(token)}`, label:`beneficiary ${token.slice(0,24)}` }
  }

  const purchase = d.match(/PURCHASE\s*-\s*([A-Za-z0-9][A-Za-z0-9 ]{2,40})/i)
  if (purchase?.[1]) {
    const merchant = purchase[1].split(/PlusMall|Plus Mall|CAIRO|PurchaseWith|Purchase With|\bEG\b/i)[0].trim()
    if (merchant.length >= 3) return {
      field:'description',
      pattern:`PURCHASE\\s*-\\s*${esc(merchant).replace(/\s+/g,'\\s*')}`,
      label:`merchant ${merchant.slice(0,32)}`
    }
  }

  const cleaned = d
    .replace(/\bFT[A-Z0-9]{8,}\b/gi,' ')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{20,}/gi,' ')
    .replace(/\b\d{8,}\b/g,' ')
    .replace(/\b(Total|Fees|CR|DR)\b/gi,' ')
    .replace(/[^A-Za-z\u0600-\u06FF0-9 ]+/g,' ')
    .replace(/\s+/g,' ').trim()

  const tokens = cleaned.split(' ').filter(t => t.length >= 4).slice(0,5)
  if (tokens.length >= 2) return {
    field:'description',
    pattern:tokens.map(esc).join('.*'),
    label:tokens.slice(0,3).join(' ').slice(0,36)
  }
  return null
}

async function rules(admin: any) {
  return admin.from('bank_classification_rules')
    .select('id,name,category_code,direction_scope,match_field,pattern,priority,confidence_score,amount_min,amount_max,rule_origin,use_count,is_active')
    .eq('is_active', true)
}
async function suggestOne(admin: any, tx: any, rule: any) {
  const score = Number(rule.confidence_score ?? 0.75)
  const reason = `Matched rule "${rule.name}" (${Math.round(score*100)}% confidence)`
  const now = new Date().toISOString()
  const { data, error } = await admin.from('bank_transactions').update({
    category_code: rule.category_code,
    classification_status:'suggested',
    classification_note:reason,
    classification_source:'rule',
    classification_confidence:score,
    classification_reason:reason,
    classification_rule_id:rule.id,
    classified_by:null,
    classified_at:now,
  }).eq('id',tx.id).neq('classification_status','confirmed')
    .select('id,category_code,classification_status,classification_note,classification_confidence,classification_reason,classification_rule_id')
    .maybeSingle()

  if (!error && data) {
    await admin.from('bank_classification_rules').update({
      use_count:Number(rule.use_count ?? 0)+1,
      last_used_at:now,
      updated_at:now,
    }).eq('id',rule.id)
  }
  return { data, error, score, reason }
}

export async function POST(req: Request) {
  const me = await getSessionUser()
  if (!me) return json({ok:false,error:'NOT_AUTHENTICATED'},401)
  if (me.role !== 'super_admin') return json({ok:false,error:'FORBIDDEN'},403)

  let body:any
  try { body = await req.json() } catch { return json({ok:false,error:'INVALID_BODY'},400) }
  const action = String(body?.action ?? '').trim()
  const admin = createSupabaseAdminClient()

  if (action === 'classify') {
    const id = String(body?.transaction_id ?? '')
    const category = String(body?.category_code ?? '').trim()
    const note = clean(body?.note,1000)
    if (!isUuid(id)) return json({ok:false,error:'INVALID_TRANSACTION_ID'},400)
    if (!category) return json({ok:false,error:'CATEGORY_REQUIRED'},400)

    const { data:tx, error:txErr } = await admin.from('bank_transactions').select('id,direction').eq('id',id).maybeSingle()
    if (txErr) return json({ok:false,error:'TRANSACTION_LOOKUP_FAILED',details:txErr.message},500)
    if (!tx) return json({ok:false,error:'TRANSACTION_NOT_FOUND'},404)

    const { data:cat, error:catErr } = await admin.from('bank_categories').select('code,direction_scope,is_active').eq('code',category).maybeSingle()
    if (catErr) return json({ok:false,error:'CATEGORY_LOOKUP_FAILED',details:catErr.message},500)
    if (!cat || !cat.is_active) return json({ok:false,error:'CATEGORY_NOT_FOUND'},404)
    if (cat.direction_scope !== 'both' && cat.direction_scope !== tx.direction) return json({ok:false,error:'CATEGORY_DIRECTION_MISMATCH'},400)

    const { data,error } = await admin.from('bank_transactions').update({
      category_code:category,
      classification_status:'confirmed',
      classification_note:note,
      classification_source:'manual',
      classification_confidence:1,
      classification_reason:'Confirmed manually by Super Admin',
      classification_rule_id:null,
      classified_by:me.id,
      classified_at:new Date().toISOString(),
    }).eq('id',id).select('id,category_code,classification_status,classification_note,classification_confidence,classification_reason,classification_rule_id').single()

    if (error) return json({ok:false,error:'CLASSIFICATION_SAVE_FAILED',details:error.message},500)
    return json({ok:true,transaction:data})
  }

  if (action === 'clear') {
    const id = String(body?.transaction_id ?? '')
    if (!isUuid(id)) return json({ok:false,error:'INVALID_TRANSACTION_ID'},400)
    const { data,error } = await admin.from('bank_transactions').update({
      category_code:null,classification_status:'unclassified',classification_note:null,
      classification_source:null,classification_confidence:null,classification_reason:null,
      classification_rule_id:null,classified_by:null,classified_at:null,
    }).eq('id',id).select('id').single()
    if (error) return json({ok:false,error:'CLASSIFICATION_CLEAR_FAILED',details:error.message},500)
    return json({ok:true,transaction:data})
  }

  if (action === 'suggest') {
    const id = String(body?.transaction_id ?? '')
    if (!isUuid(id)) return json({ok:false,error:'INVALID_TRANSACTION_ID'},400)
    const { data:tx,error:txErr } = await admin.from('bank_transactions')
      .select('id,direction,amount,description,counterparty,reference,classification_status').eq('id',id).maybeSingle()
    if (txErr) return json({ok:false,error:'TRANSACTION_LOOKUP_FAILED',details:txErr.message},500)
    if (!tx) return json({ok:false,error:'TRANSACTION_NOT_FOUND'},404)
    if (tx.classification_status === 'confirmed') return json({ok:false,error:'CONFIRMED_TRANSACTION_NOT_OVERRIDDEN'},409)

    const loaded = await rules(admin)
    if (loaded.error) return json({ok:false,error:'RULES_LOAD_FAILED',details:loaded.error.message},500)
    const rule = bestRule(tx, loaded.data ?? [])
    if (!rule) return json({ok:true,suggestion:null})

    const result = await suggestOne(admin,tx,rule)
    if (result.error) return json({ok:false,error:'SUGGESTION_SAVE_FAILED',details:result.error.message},500)
    return json({ok:true,suggestion:result.data,rule,confidence_band:band(result.score)})
  }

  if (action === 'suggest_all') {
    const loaded = await rules(admin)
    if (loaded.error) return json({ok:false,error:'RULES_LOAD_FAILED',details:loaded.error.message},500)
    const { data:txs,error:txErr } = await admin.from('bank_transactions')
      .select('id,direction,amount,description,counterparty,reference,classification_status')
      .neq('classification_status','confirmed').limit(5000)
    if (txErr) return json({ok:false,error:'TRANSACTIONS_LOAD_FAILED',details:txErr.message},500)

    let updated=0,high=0,medium=0,low=0
    for (const tx of txs ?? []) {
      const rule = bestRule(tx,loaded.data ?? [])
      if (!rule) continue
      const result = await suggestOne(admin,tx,rule)
      if (result.error || !result.data) continue
      updated += 1
      const b = band(result.score)
      if (b==='high') high += 1
      else if (b==='medium') medium += 1
      else low += 1
    }
    return json({ok:true,updated,high,medium,low})
  }

  if (action === 'learn') {
    const id = String(body?.transaction_id ?? '')
    const category = String(body?.category_code ?? '').trim()
    if (!isUuid(id)) return json({ok:false,error:'INVALID_TRANSACTION_ID'},400)
    if (!category) return json({ok:false,error:'CATEGORY_REQUIRED'},400)

    const { data:tx,error:txErr } = await admin.from('bank_transactions')
      .select('id,direction,amount,description,counterparty,reference').eq('id',id).maybeSingle()
    if (txErr) return json({ok:false,error:'TRANSACTION_LOOKUP_FAILED',details:txErr.message},500)
    if (!tx) return json({ok:false,error:'TRANSACTION_NOT_FOUND'},404)

    const learned = learnedPattern(tx)
    if (!learned) return json({ok:false,error:'NO_SAFE_LEARNING_PATTERN'},400)

    const { data:cat } = await admin.from('bank_categories').select('code,direction_scope,is_active').eq('code',category).maybeSingle()
    if (!cat || !cat.is_active) return json({ok:false,error:'CATEGORY_NOT_FOUND'},404)
    if (cat.direction_scope !== 'both' && cat.direction_scope !== tx.direction) return json({ok:false,error:'CATEGORY_DIRECTION_MISMATCH'},400)

    const { data:existing } = await admin.from('bank_classification_rules')
      .select('id,name,category_code,direction_scope,match_field,pattern,priority,confidence_score,amount_min,amount_max,rule_origin,use_count,is_active')
      .eq('rule_origin','manual_learning').eq('direction_scope',tx.direction)
      .eq('match_field',learned.field).eq('pattern',learned.pattern).limit(1)

    let rule:any = existing?.[0] ?? null
    if (rule && rule.category_code !== category) return json({
      ok:false,error:'LEARNING_RULE_CONFLICT',
      details:`A learned rule for this signature already points to ${rule.category_code}. Review Smart Rules first.`
    },409)

    if (!rule) {
      const inserted = await admin.from('bank_classification_rules').insert({
        name:`Learned · ${category} · ${learned.label}`.slice(0,200),
        category_code:category,
        direction_scope:tx.direction,
        match_field:learned.field,
        pattern:learned.pattern,
        priority:15,
        confidence_score:0.9000,
        rule_origin:'manual_learning',
        learned_from_transaction_id:tx.id,
        created_by:me.id,
      }).select('id,name,category_code,direction_scope,match_field,pattern,priority,confidence_score,amount_min,amount_max,rule_origin,use_count,is_active').single()
      if (inserted.error) return json({ok:false,error:'LEARNING_RULE_CREATE_FAILED',details:inserted.error.message},500)
      rule = inserted.data
    }

    const { data:candidates,error:candidateErr } = await admin.from('bank_transactions')
      .select('id,direction,amount,description,counterparty,reference,classification_status')
      .eq('direction',tx.direction).neq('classification_status','confirmed').limit(5000)
    if (candidateErr) return json({ok:false,error:'SIMILAR_TRANSACTIONS_LOAD_FAILED',details:candidateErr.message},500)

    let suggested=0
    for (const candidate of candidates ?? []) {
      if (!matches(candidate,rule)) continue
      const result = await suggestOne(admin,candidate,rule)
      if (!result.error && result.data) suggested += 1
    }
    return json({ok:true,rule,suggested})
  }

  if (action === 'confirm_rule_matches') {
    const ruleId = String(body?.rule_id ?? '')
    if (!isUuid(ruleId)) return json({ok:false,error:'INVALID_RULE_ID'},400)
    const { data:rule,error:ruleErr } = await admin.from('bank_classification_rules')
      .select('id,name,category_code,is_active').eq('id',ruleId).maybeSingle()
    if (ruleErr) return json({ok:false,error:'RULE_LOOKUP_FAILED',details:ruleErr.message},500)
    if (!rule || !rule.is_active) return json({ok:false,error:'RULE_NOT_ACTIVE'},400)

    const { data,error } = await admin.from('bank_transactions').update({
      classification_status:'confirmed',
      classification_source:'manual',
      classification_confidence:1,
      classification_reason:`Bulk confirmed from rule "${rule.name}"`,
      classified_by:me.id,
      classified_at:new Date().toISOString(),
    }).eq('classification_rule_id',ruleId).eq('classification_status','suggested')
      .eq('category_code',rule.category_code).select('id')

    if (error) return json({ok:false,error:'BULK_CONFIRM_FAILED',details:error.message},500)
    return json({ok:true,confirmed:data?.length ?? 0})
  }

  return json({ok:false,error:'UNKNOWN_ACTION'},400)
}
