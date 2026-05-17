export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { canAccessStoreExpenses, normalizeRole, type Role } from '@/lib/rbac'

const CATEGORIES = new Set(['supplier_order', 'transport', 'customs_taxes', 'packaging', 'refund', 'other'])
const PAYMENT_METHODS = new Set(['cash', 'card', 'bank_transfer', 'instapay'])

type RangePreset = 'today' | '7d' | 'month' | 'custom'

type SupplierOrderExportRow = {
  id: string
  reference: string | null
  supplier_name: string | null
  status: string | null
}

type ExpenseExportRow = {
  id: string
  expense_date: string | null
  category: string | null
  title: string | null
  amount_cents: number | null
  currency: string | null
  payment_method: string | null
  supplier_order_id: string | null
  vendor_name: string | null
  note: string | null
  attachment_filename: string | null
  created_at: string | null
  updated_at: string | null
}

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function isDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function toISODate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function parsePreset(value: string | null): RangePreset {
  return value === 'today' || value === '7d' || value === 'month' || value === 'custom' ? value : 'month'
}

function sanitizeSearch(value: string) {
  return value.replace(/[%,_]/g, ' ').replace(/\s+/g, ' ').trim()
}

function categoryLabel(value?: string | null) {
  switch (value) {
    case 'supplier_order':
      return 'Supplier order'
    case 'transport':
      return 'Transport'
    case 'customs_taxes':
      return 'Customs / taxes'
    case 'packaging':
      return 'Packaging'
    case 'refund':
      return 'Refund'
    case 'other':
      return 'Other'
    default:
      return value || ''
  }
}

function paymentLabel(value?: string | null) {
  switch (value) {
    case 'cash':
      return 'Cash'
    case 'card':
      return 'Card'
    case 'instapay':
      return 'Instapay'
    case 'bank_transfer':
      return 'Bank transfer'
    default:
      return value || ''
  }
}

function supplierOrderLabel(row?: SupplierOrderExportRow | null, fallbackId?: string | null) {
  if (!row && !fallbackId) return ''
  const ref = row?.reference?.trim() || (fallbackId ? `Order ${fallbackId.slice(0, 8)}` : '')
  const supplier = row?.supplier_name?.trim() || ''
  const status = row?.status?.replaceAll('_', ' ') || ''
  return [ref, supplier, status].filter(Boolean).join(' · ')
}

function amountEgP(cents?: number | null) {
  const n = Number(cents ?? 0)
  if (!Number.isFinite(n)) return '0.00'
  return (n / 100).toFixed(2)
}

function csvCell(value: unknown) {
  const text = String(value ?? '')
  if (/[,"\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function csvLine(values: unknown[]) {
  return values.map(csvCell).join(',')
}

async function requireStoreExpenseAccess() {
  const authClient = createSupabaseServerActionClient()
  const { data: auth, error: authErr } = await authClient.auth.getUser()
  if (authErr) return { ok: false as const, response: json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message }) }
  if (!auth.user) return { ok: false as const, response: json(401, { ok: false, error: 'NOT_AUTHENTICATED' }) }

  const { data: me, error: meErr } = await authClient
    .from('profiles')
    .select('role')
    .eq('user_id', auth.user.id)
    .maybeSingle<{ role: Role | null }>()

  if (meErr) return { ok: false as const, response: json(500, { ok: false, error: 'PROFILE_ERROR', details: meErr.message }) }
  const role = normalizeRole(me?.role)
  if (!canAccessStoreExpenses(role)) return { ok: false as const, response: json(403, { ok: false, error: 'FORBIDDEN' }) }

  return { ok: true as const }
}

export async function GET(req: Request) {
  const guard = await requireStoreExpenseAccess()
  if (!guard.ok) return guard.response

  const url = new URL(req.url)
  const now = new Date()
  const today = toISODate(now)
  const preset = parsePreset(url.searchParams.get('preset'))

  let from = url.searchParams.get('from') || ''
  let to = url.searchParams.get('to') || ''

  if (preset === 'today') {
    from = today
    to = today
  } else if (preset === '7d') {
    to = today
    from = toISODate(addDays(now, -6))
  } else if (preset === 'month') {
    from = toISODate(startOfMonth(now))
    to = toISODate(endOfMonth(now))
  } else {
    if (!isDateOnly(from)) from = toISODate(startOfMonth(now))
    if (!isDateOnly(to)) to = toISODate(endOfMonth(now))
  }

  if (!isDateOnly(from) || !isDateOnly(to)) {
    return json(400, { ok: false, error: 'INVALID_DATE_RANGE' })
  }

  const categoryRaw = url.searchParams.get('category') || 'all'
  const paymentRaw = url.searchParams.get('payment_method') || 'all'
  const category = CATEGORIES.has(categoryRaw) ? categoryRaw : 'all'
  const paymentMethod = PAYMENT_METHODS.has(paymentRaw) ? paymentRaw : 'all'
  const supplierOrderRaw = url.searchParams.get('supplier_order_id') || 'all'
  const supplierOrderId = supplierOrderRaw !== 'all' && isUuid(supplierOrderRaw) ? supplierOrderRaw : 'all'
  const q = sanitizeSearch(url.searchParams.get('q') || '')

  const admin = createSupabaseAdminClient()
  let query = admin
    .from('store_expenses')
    .select('id,expense_date,category,title,amount_cents,currency,payment_method,supplier_order_id,vendor_name,note,attachment_filename,created_at,updated_at')
    .is('deleted_at', null)
    .gte('expense_date', from)
    .lte('expense_date', to)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(10000)

  if (category !== 'all') query = query.eq('category', category)
  if (paymentMethod !== 'all') query = query.eq('payment_method', paymentMethod)
  if (supplierOrderId !== 'all') query = query.eq('supplier_order_id', supplierOrderId)
  if (q) {
    const like = `%${q}%`
    query = query.or(`title.ilike.${like},vendor_name.ilike.${like},note.ilike.${like}`)
  }

  const { data, error } = await query
  if (error) return json(500, { ok: false, error: 'EXPORT_FAILED', details: error.message })

  const rows = (data ?? []) as ExpenseExportRow[]
  const supplierOrderIds = Array.from(new Set(rows.map((row) => row.supplier_order_id).filter(Boolean))) as string[]
  const supplierOrderMap = new Map<string, SupplierOrderExportRow>()

  if (supplierOrderIds.length > 0) {
    const { data: supplierRows } = await admin
      .from('store_supplier_orders')
      .select('id,reference,supplier_name,status')
      .in('id', supplierOrderIds)

    for (const row of (supplierRows ?? []) as SupplierOrderExportRow[]) {
      supplierOrderMap.set(row.id, row)
    }
  }

  const header = csvLine([
    'Expense date',
    'Category',
    'Title',
    'Related supplier order',
    'Related supplier order ID',
    'Vendor / supplier',
    'Payment method',
    'Amount EGP',
    'Currency',
    'Note',
    'Attachment filename',
    'Created at',
    'Updated at',
    'ID',
  ])

  const body = rows.map((row) => csvLine([
    row.expense_date || '',
    categoryLabel(row.category),
    row.title || '',
    supplierOrderLabel(row.supplier_order_id ? supplierOrderMap.get(row.supplier_order_id) : null, row.supplier_order_id),
    row.supplier_order_id || '',
    row.vendor_name || '',
    paymentLabel(row.payment_method),
    amountEgP(row.amount_cents),
    row.currency || 'EGP',
    row.note || '',
    row.attachment_filename || '',
    row.created_at || '',
    row.updated_at || '',
    row.id,
  ]))

  const csv = ['\uFEFF' + header, ...body].join('\n')
  const filename = `store-expenses-${from}-to-${to}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
