export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

const STATUSES = ['unclassified', 'suggested', 'confirmed'] as const

function json(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function isUuid(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isStatus(value: unknown): value is (typeof STATUSES)[number] {
  return typeof value === 'string' && STATUSES.includes(value as any)
}

function normalizeText(value: unknown, max: number) {
  const text = String(value ?? '').trim()
  return text ? text.slice(0, max) : null
}

function combinedText(row: any) {
  return [
    row.description,
    row.counterparty,
    row.reference,
  ].filter(Boolean).join(' ').toLowerCase()
}

function fieldText(row: any, field: string) {
  if (field === 'description') return String(row.description ?? '').toLowerCase()
  if (field === 'counterparty') return String(row.counterparty ?? '').toLowerCase()
  if (field === 'reference') return String(row.reference ?? '').toLowerCase()
  return combinedText(row)
}

function matchesPattern(text: string, pattern: string) {
  try {
    const re = new RegExp(pattern, 'i')
    return re.test(text)
  } catch {
    return text.includes(pattern.toLowerCase())
  }
}

export async function POST(req: Request) {
  const me = await getSessionUser()
  if (!me) return json({ ok: false, error: 'NOT_AUTHENTICATED' }, 401)
  if (me.role !== 'super_admin') return json({ ok: false, error: 'FORBIDDEN' }, 403)

  let body: any
  try { body = await req.json() } catch {
    return json({ ok: false, error: 'INVALID_BODY' }, 400)
  }

  const action = String(body?.action ?? '').trim()
  const admin = createSupabaseAdminClient()

  if (action === 'classify') {
    const transactionId = String(body?.transaction_id ?? '').trim()
    if (!isUuid(transactionId)) return json({ ok: false, error: 'INVALID_TRANSACTION_ID' }, 400)

    const categoryCode = String(body?.category_code ?? '').trim()
    const status = String(body?.status ?? '').trim()
    const note = normalizeText(body?.note, 1000)

    if (!categoryCode) return json({ ok: false, error: 'CATEGORY_REQUIRED' }, 400)
    if (!isStatus(status)) return json({ ok: false, error: 'INVALID_STATUS' }, 400)

    const { data: tx, error: txError } = await admin
      .from('bank_transactions')
      .select('id,direction')
      .eq('id', transactionId)
      .maybeSingle()

    if (txError) return json({ ok: false, error: 'TRANSACTION_LOOKUP_FAILED', details: txError.message }, 500)
    if (!tx) return json({ ok: false, error: 'TRANSACTION_NOT_FOUND' }, 404)

    const { data: category, error: categoryError } = await admin
      .from('bank_categories')
      .select('code,direction_scope,is_active')
      .eq('code', categoryCode)
      .maybeSingle()

    if (categoryError) return json({ ok: false, error: 'CATEGORY_LOOKUP_FAILED', details: categoryError.message }, 500)
    if (!category || !category.is_active) return json({ ok: false, error: 'CATEGORY_NOT_FOUND' }, 404)
    if (category.direction_scope !== 'both' && category.direction_scope !== tx.direction) {
      return json({ ok: false, error: 'CATEGORY_DIRECTION_MISMATCH' }, 400)
    }

    const now = new Date().toISOString()
    const { data, error } = await admin
      .from('bank_transactions')
      .update({
        category_code: categoryCode,
        classification_status: status,
        classification_note: note,
        classification_source: 'manual',
        classified_by: me.id,
        classified_at: now,
      })
      .eq('id', transactionId)
      .select('id,category_code,classification_status,classification_note,classification_source,classified_by,classified_at')
      .single()

    if (error) return json({ ok: false, error: 'CLASSIFICATION_SAVE_FAILED', details: error.message }, 500)
    return json({ ok: true, transaction: data })
  }

  if (action === 'clear') {
    const transactionId = String(body?.transaction_id ?? '').trim()
    if (!isUuid(transactionId)) return json({ ok: false, error: 'INVALID_TRANSACTION_ID' }, 400)

    const { data, error } = await admin
      .from('bank_transactions')
      .update({
        category_code: null,
        classification_status: 'unclassified',
        classification_note: null,
        classification_source: null,
        classified_by: null,
        classified_at: null,
      })
      .eq('id', transactionId)
      .select('id,category_code,classification_status,classification_note,classification_source,classified_by,classified_at')
      .single()

    if (error) return json({ ok: false, error: 'CLASSIFICATION_CLEAR_FAILED', details: error.message }, 500)
    return json({ ok: true, transaction: data })
  }

  if (action === 'suggest') {
    const transactionId = String(body?.transaction_id ?? '').trim()
    if (!isUuid(transactionId)) return json({ ok: false, error: 'INVALID_TRANSACTION_ID' }, 400)

    const { data: tx, error: txError } = await admin
      .from('bank_transactions')
      .select('id,direction,description,counterparty,reference,classification_status')
      .eq('id', transactionId)
      .maybeSingle()

    if (txError) return json({ ok: false, error: 'TRANSACTION_LOOKUP_FAILED', details: txError.message }, 500)
    if (!tx) return json({ ok: false, error: 'TRANSACTION_NOT_FOUND' }, 404)
    if (tx.classification_status === 'confirmed') {
      return json({ ok: false, error: 'CONFIRMED_TRANSACTION_NOT_OVERRIDDEN' }, 409)
    }

    const { data: rules, error: rulesError } = await admin
      .from('bank_classification_rules')
      .select('id,name,category_code,direction_scope,match_field,pattern,priority')
      .eq('is_active', true)
      .order('priority', { ascending: true })

    if (rulesError) return json({ ok: false, error: 'RULES_LOAD_FAILED', details: rulesError.message }, 500)

    const matched = (rules ?? []).find((rule: any) => {
      if (rule.direction_scope !== 'both' && rule.direction_scope !== tx.direction) return false
      return matchesPattern(fieldText(tx, rule.match_field), String(rule.pattern ?? ''))
    })

    if (!matched) {
      return json({ ok: true, suggestion: null })
    }

    const now = new Date().toISOString()
    const { data, error } = await admin
      .from('bank_transactions')
      .update({
        category_code: matched.category_code,
        classification_status: 'suggested',
        classification_note: `Suggested by rule: ${matched.name}`,
        classification_source: 'rule',
        classified_by: null,
        classified_at: now,
      })
      .eq('id', transactionId)
      .select('id,category_code,classification_status,classification_note,classification_source,classified_by,classified_at')
      .single()

    if (error) return json({ ok: false, error: 'SUGGESTION_SAVE_FAILED', details: error.message }, 500)
    return json({ ok: true, suggestion: data, rule: matched })
  }

  if (action === 'suggest_all') {
    const { data: rules, error: rulesError } = await admin
      .from('bank_classification_rules')
      .select('id,name,category_code,direction_scope,match_field,pattern,priority')
      .eq('is_active', true)
      .order('priority', { ascending: true })

    if (rulesError) return json({ ok: false, error: 'RULES_LOAD_FAILED', details: rulesError.message }, 500)

    const { data: txs, error: txError } = await admin
      .from('bank_transactions')
      .select('id,direction,description,counterparty,reference,classification_status')
      .neq('classification_status', 'confirmed')
      .limit(5000)

    if (txError) return json({ ok: false, error: 'TRANSACTIONS_LOAD_FAILED', details: txError.message }, 500)

    let updated = 0

    for (const tx of txs ?? []) {
      const matched = (rules ?? []).find((rule: any) => {
        if (rule.direction_scope !== 'both' && rule.direction_scope !== tx.direction) return false
        return matchesPattern(fieldText(tx, rule.match_field), String(rule.pattern ?? ''))
      })

      if (!matched) continue

      const { error } = await admin
        .from('bank_transactions')
        .update({
          category_code: matched.category_code,
          classification_status: 'suggested',
          classification_note: `Suggested by rule: ${matched.name}`,
          classification_source: 'rule',
          classified_by: null,
          classified_at: new Date().toISOString(),
        })
        .eq('id', tx.id)
        .neq('classification_status', 'confirmed')

      if (!error) updated += 1
    }

    return json({ ok: true, updated })
  }

  return json({ ok: false, error: 'UNKNOWN_ACTION' }, 400)
}
