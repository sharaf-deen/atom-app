export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

function json(body: unknown, status = 200) {
  const r = NextResponse.json(body, { status })
  r.headers.set('Cache-Control','no-store')
  return r
}
function isUuid(v: unknown) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
}
function boundedNumber(v: unknown, min: number, max: number) {
  const n = Number(v)
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}
function nullableMoney(v: unknown) {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN
}

export async function POST(req: Request) {
  const me = await getSessionUser()
  if (!me) return json({ok:false,error:'NOT_AUTHENTICATED'},401)
  if (me.role !== 'super_admin') return json({ok:false,error:'FORBIDDEN'},403)

  let body:any
  try { body = await req.json() } catch { return json({ok:false,error:'INVALID_BODY'},400) }

  const action = String(body?.action ?? '').trim()
  const id = String(body?.id ?? '').trim()
  if (!isUuid(id)) return json({ok:false,error:'INVALID_RULE_ID'},400)

  const admin = createSupabaseAdminClient()

  if (action === 'toggle') {
    const enabled = Boolean(body?.is_active)
    const { data,error } = await admin.from('bank_classification_rules').update({
      is_active:enabled,
      updated_at:new Date().toISOString(),
    }).eq('id',id).select('id,is_active').single()
    if (error) return json({ok:false,error:'RULE_TOGGLE_FAILED',details:error.message},500)
    return json({ok:true,rule:data})
  }

  if (action === 'update') {
    const name = String(body?.name ?? '').trim().slice(0,200)
    const category = String(body?.category_code ?? '').trim()
    const direction = String(body?.direction_scope ?? '').trim()
    const field = String(body?.match_field ?? '').trim()
    const pattern = String(body?.pattern ?? '').trim().slice(0,1000)
    const priority = Math.round(Number(body?.priority))
    const confidence = boundedNumber(body?.confidence_score,0,1)
    const amountMin = nullableMoney(body?.amount_min)
    const amountMax = nullableMoney(body?.amount_max)

    if (!name) return json({ok:false,error:'RULE_NAME_REQUIRED'},400)
    if (!category) return json({ok:false,error:'CATEGORY_REQUIRED'},400)
    if (!['credit','debit','both'].includes(direction)) return json({ok:false,error:'INVALID_DIRECTION'},400)
    if (!['combined','description','counterparty','reference'].includes(field)) return json({ok:false,error:'INVALID_MATCH_FIELD'},400)
    if (!pattern) return json({ok:false,error:'PATTERN_REQUIRED'},400)
    if (!Number.isFinite(priority) || priority < 1 || priority > 9999) return json({ok:false,error:'INVALID_PRIORITY'},400)
    if (confidence === null) return json({ok:false,error:'INVALID_CONFIDENCE'},400)
    if (Number.isNaN(amountMin) || Number.isNaN(amountMax)) return json({ok:false,error:'INVALID_AMOUNT_RANGE'},400)
    if (amountMin !== null && amountMax !== null && amountMin > amountMax) return json({ok:false,error:'INVALID_AMOUNT_RANGE'},400)

    try { new RegExp(pattern,'i') } catch {
      return json({ok:false,error:'INVALID_REGEX_PATTERN'},400)
    }

    const { data:cat,error:catErr } = await admin.from('bank_categories')
      .select('code,direction_scope,is_active').eq('code',category).maybeSingle()
    if (catErr) return json({ok:false,error:'CATEGORY_LOOKUP_FAILED',details:catErr.message},500)
    if (!cat || !cat.is_active) return json({ok:false,error:'CATEGORY_NOT_FOUND'},404)
    if (direction !== 'both' && cat.direction_scope !== 'both' && cat.direction_scope !== direction) {
      return json({ok:false,error:'CATEGORY_DIRECTION_MISMATCH'},400)
    }

    const { data,error } = await admin.from('bank_classification_rules').update({
      name,
      category_code:category,
      direction_scope:direction,
      match_field:field,
      pattern,
      priority,
      confidence_score:confidence,
      amount_min:amountMin,
      amount_max:amountMax,
      updated_at:new Date().toISOString(),
    }).eq('id',id)
      .select('id,name,category_code,direction_scope,match_field,pattern,priority,confidence_score,amount_min,amount_max,rule_origin,is_active,use_count,last_used_at')
      .single()

    if (error) return json({ok:false,error:'RULE_UPDATE_FAILED',details:error.message},500)
    return json({ok:true,rule:data})
  }

  return json({ok:false,error:'UNKNOWN_ACTION'},400)
}
