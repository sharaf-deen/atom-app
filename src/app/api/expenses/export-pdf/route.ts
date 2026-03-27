// src/app/api/expenses/export-pdf/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { canAccessExpenses, normalizeRole, type Role } from '@/lib/rbac'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { isISODateOnly, isSimpleKey, sanitizeSearch } from '@/lib/inputGuard'

type ExpenseRow = {
  id: string
  date: string
  category_key: string | null
  description: string | null
  amount: number
  payment_method: string | null
}

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

function fmtMoneyEGP(n: number) {
  const safe = Number.isFinite(n) ? n : 0
  return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format(safe)
}

function fmtDate(isoDateOnly: string) {
  const [y, m, d] = isoDateOnly.split('-').map((x) => Number(x))
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1))
  if (Number.isNaN(dt.getTime())) return isoDateOnly
  return dt.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })
}

function paymentLabel(v?: string | null) {
  if (!v) return '—'
  if (v === 'cash') return 'Cash'
  if (v === 'visa') return 'Visa'
  if (v === 'instapay') return 'Instapay'
  if (v === 'bank_transfer') return 'Bank transfer'
  return v
}

function truncate(s: string, max: number) {
  const t = (s || '').trim()
  if (t.length <= max) return t
  return t.slice(0, Math.max(0, max - 1)).trimEnd() + '…'
}

export async function GET(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()
    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) return json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle<{ role: Role | null }>()

    if (meErr) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message })

    const role = normalizeRole(me?.role)
    if (!canAccessExpenses(role)) return json(403, { ok: false, error: 'FORBIDDEN' })

    const admin = makeAdminClient()
    if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_MISSING' })

    const { searchParams } = new URL(req.url)
    const from = (searchParams.get('from') ?? '').trim()
    const to = (searchParams.get('to') ?? '').trim()
    const categoryRaw = (searchParams.get('category') ?? 'all').trim().toLowerCase()
    const payment_method = (searchParams.get('payment_method') ?? 'all').trim().toLowerCase()
    const qRaw = searchParams.get('q') ?? ''
    const qText = sanitizeSearch(qRaw, { max: 120 })

    if (!isISODateOnly(from) || !isISODateOnly(to) || from > to) {
      return json(400, { ok: false, error: 'INVALID_RANGE', hint: 'Use ?from=YYYY-MM-DD&to=YYYY-MM-DD with from ≤ to' })
    }

    const allowedMethods = new Set(['all', 'cash', 'visa', 'instapay', 'bank_transfer'])
    if (!allowedMethods.has(payment_method)) return json(400, { ok: false, error: 'INVALID_PAYMENT_METHOD' })

    const category = !categoryRaw || categoryRaw === 'all' ? 'all' : categoryRaw
    if (category !== 'all' && !isSimpleKey(category, 64)) return json(400, { ok: false, error: 'INVALID_CATEGORY' })

    const { data: cats } = await admin.from('expense_categories').select('key,label').eq('is_active', true)
    const labelByKey = new Map<string, string>()
    for (const c of cats ?? []) labelByKey.set(c.key, c.label)

    let q = admin
      .from('expenses')
      .select('id,date,category_key,description,amount,payment_method')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false })
      .order('id', { ascending: false })
      .limit(100000)

    if (category !== 'all') q = q.eq('category_key', category)
    if (payment_method !== 'all') q = q.eq('payment_method', payment_method)
    if (qText) {
      const like = `%${qText}%`
      q = q.or(`description.ilike.${like},category_key.ilike.${like},payment_method.ilike.${like}`)
    }

    const { data: rows, error: qErr } = await q
    if (qErr) return json(500, { ok: false, error: 'QUERY_FAILED', details: qErr.message })

    const expenses = (rows || []) as ExpenseRow[]
    const total = expenses.reduce((sum, r) => sum + (Number.isFinite(Number(r.amount)) ? Number(r.amount) : 0), 0)
    const breakdown = { cash: 0, visa: 0, instapay: 0, bank_transfer: 0 }
    for (const r of expenses) {
      const amt = Number(r.amount || 0)
      if (!Number.isFinite(amt)) continue
      const method = String(r.payment_method || 'cash')
      if (method === 'visa') breakdown.visa += amt
      else if (method === 'instapay') breakdown.instapay += amt
      else if (method === 'bank_transfer') breakdown.bank_transfer += amt
      else breakdown.cash += amt
    }

    const pdfDoc = await PDFDocument.create()
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

    const pageSize: [number, number] = [595.28, 841.89]
    const marginX = 40
    const marginTop = 46
    const marginBottom = 40

    const colDateX = marginX
    const colCatX = colDateX + 72
    const colPayX = colCatX + 118
    const colAmtX = colPayX + 86
    const colDescX = colAmtX + 86
    const rowH = 14

    const drawHeader = (page: any, pageIndex: number) => {
      const { width, height } = page.getSize()
      const topY = height - marginTop

      page.drawText('Expenses Report', { x: marginX, y: topY, size: 18, font: fontBold })
      page.drawText(`From: ${fmtDate(from)}   To: ${fmtDate(to)}`, { x: marginX, y: topY - 18, size: 10, font })

      const filters: string[] = []
      if (category !== 'all') filters.push(`Category: ${category}`)
      if (payment_method !== 'all') filters.push(`Payment: ${paymentLabel(payment_method)}`)
      if (qText) filters.push(`Search: ${truncate(qText, 36)}`)
      if (filters.length) {
        page.drawText(filters.join(' · '), { x: marginX, y: topY - 32, size: 9, font })
      }

      page.drawText(`Items: ${expenses.length}   Total: ${fmtMoneyEGP(total)}`, { x: marginX, y: topY - 48, size: 10, font: fontBold })
      page.drawText(
        `Cash: ${fmtMoneyEGP(breakdown.cash)}   Visa: ${fmtMoneyEGP(breakdown.visa)}   Instapay: ${fmtMoneyEGP(breakdown.instapay)}   Bank: ${fmtMoneyEGP(breakdown.bank_transfer)}`,
        { x: marginX, y: topY - 62, size: 8, font }
      )

      const headerY = topY - 86
      page.drawText('Date', { x: colDateX, y: headerY, size: 10, font: fontBold })
      page.drawText('Category', { x: colCatX, y: headerY, size: 10, font: fontBold })
      page.drawText('Payment', { x: colPayX, y: headerY, size: 10, font: fontBold })
      page.drawText('Amount', { x: colAmtX, y: headerY, size: 10, font: fontBold })
      page.drawText('Description', { x: colDescX, y: headerY, size: 10, font: fontBold })

      page.drawLine({
        start: { x: marginX, y: headerY - 4 },
        end: { x: width - marginX, y: headerY - 4 },
        thickness: 1,
        color: rgb(0.85, 0.85, 0.85),
      })

      page.drawText(`Page ${pageIndex}`, { x: width - marginX - 60, y: marginBottom - 10, size: 9, font })
      return headerY - 18
    }

    let page = pdfDoc.addPage(pageSize)
    let pageIndex = 1
    let y = drawHeader(page, pageIndex)

    for (const r of expenses) {
      if (y <= marginBottom + 20) {
        page = pdfDoc.addPage(pageSize)
        pageIndex += 1
        y = drawHeader(page, pageIndex)
      }

      const cat = labelByKey.get(r.category_key ?? '') ?? r.category_key ?? '—'
      const desc = truncate(r.description ?? '—', 34)

      page.drawText(fmtDate(r.date), { x: colDateX, y, size: 9, font })
      page.drawText(truncate(cat, 18), { x: colCatX, y, size: 9, font })
      page.drawText(truncate(paymentLabel(r.payment_method), 14), { x: colPayX, y, size: 9, font })
      page.drawText(truncate(fmtMoneyEGP(Number(r.amount ?? 0)), 14), { x: colAmtX, y, size: 9, font: fontBold })
      page.drawText(desc, { x: colDescX, y, size: 9, font })

      y -= rowH
    }

    const pdfBytes = await pdfDoc.save()
    const filename = `expenses_${from}_to_${to}.pdf`

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
