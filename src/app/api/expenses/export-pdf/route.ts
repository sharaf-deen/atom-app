// src/app/api/expenses/export-pdf/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

type Role = 'member' | 'assistant_coach' | 'coach' | 'reception' | 'admin' | 'super_admin'

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

function isISODateOnly(s?: string | null) {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function sanitizeSearch(v: string) {
  // Keep it compatible with Supabase .or() string syntax
  return (v || '').replace(/[%,_]/g, ' ').replace(/\s+/g, ' ').trim()
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

function fmtMoneyEGP(n: number) {
  const safe = Number.isFinite(n) ? n : 0
  return new Intl.NumberFormat('en-EG', {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 2,
  }).format(safe)
}

function fmtDate(isoDateOnly: string) {
  // isoDateOnly: YYYY-MM-DD
  const [y, m, d] = isoDateOnly.split('-').map((x) => Number(x))
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1))
  if (Number.isNaN(dt.getTime())) return isoDateOnly
  return dt.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })
}

function paymentLabel(v?: string | null) {
  if (!v) return '—'
  switch (v) {
    case 'cash':
      return 'Cash'
    case 'visa':
      return 'Visa'
    case 'instapay':
      return 'Instapay'
    case 'bank_transfer':
      return 'Bank transfer'
    default:
      return v
  }
}

function truncate(s: string, max: number) {
  const t = (s || '').trim()
  if (t.length <= max) return t
  return t.slice(0, Math.max(0, max - 1)).trimEnd() + '…'
}

export async function GET(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    // Auth
    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) return json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    // Only admin / super_admin
    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle<{ role: Role | null }>()

    if (meErr) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message })

    const role: Role = (me?.role as Role) ?? 'member'
    if (!['admin', 'super_admin'].includes(role)) return json(403, { ok: false, error: 'FORBIDDEN' })

    const admin = makeAdminClient()
    if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_MISSING' })

    const { searchParams } = new URL(req.url)
    const from = searchParams.get('from') ?? ''
    const to = searchParams.get('to') ?? ''
    const category = searchParams.get('category') ?? 'all'
    const payment_method = searchParams.get('payment_method') ?? 'all'
    const qRaw = searchParams.get('q') ?? ''
    const qText = sanitizeSearch(qRaw)

    if (!isISODateOnly(from) || !isISODateOnly(to) || from > to) {
      return json(400, {
        ok: false,
        error: 'INVALID_RANGE',
        hint: 'Use ?from=YYYY-MM-DD&to=YYYY-MM-DD with from ≤ to',
      })
    }

    const allowedMethods = new Set(['all', 'cash', 'visa', 'instapay', 'bank_transfer'])
    if (!allowedMethods.has(payment_method)) {
      return json(400, { ok: false, error: 'INVALID_PAYMENT_METHOD' })
    }

    // Category labels
    const { data: cats } = await admin.from('expense_categories').select('key,label').eq('is_active', true)
    const labelByKey = new Map<string, string>()
    for (const c of cats ?? []) labelByKey.set(c.key, c.label)

    let q = admin
      .from('expenses')
      .select('id,date,category_key,description,amount,payment_method')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false })
      .limit(100000)

    if (category && category !== 'all') q = q.eq('category_key', category)
    if (payment_method && payment_method !== 'all') q = q.eq('payment_method', payment_method)

    if (qText) {
      const like = `%${qText}%`
      q = q.or(`description.ilike.${like},category_key.ilike.${like},payment_method.ilike.${like}`)
    }

    const { data: rows, error: qErr } = await q
    if (qErr) return json(500, { ok: false, error: 'QUERY_FAILED', details: qErr.message })

    const expenses = (rows || []) as ExpenseRow[]
    const total = expenses.reduce((sum, r) => sum + (Number.isFinite(Number(r.amount)) ? Number(r.amount) : 0), 0)

    // --- PDF ---
    const pdfDoc = await PDFDocument.create()
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

    const pageSize: [number, number] = [595.28, 841.89] // A4
    const marginX = 40
    const marginTop = 46
    const marginBottom = 40

    // Column layout
    const colDateX = marginX
    const colCatX = colDateX + 70
    const colPayX = colCatX + 120
    const colAmtX = colPayX + 90
    const colDescX = colAmtX + 90

    const rowH = 14

    const drawHeader = (page: any, pageIndex: number) => {
      const { width, height } = page.getSize()
      const topY = height - marginTop

      const title = 'Expenses Report'
      page.drawText(title, { x: marginX, y: topY, size: 18, font: fontBold })
      page.drawText(`From: ${fmtDate(from)}   To: ${fmtDate(to)}`, { x: marginX, y: topY - 18, size: 10, font })

      const filters: string[] = []
      if (category && category !== 'all') filters.push(`Category: ${category}`)
      if (payment_method && payment_method !== 'all') filters.push(`Payment: ${paymentLabel(payment_method)}`)
      if (qText) filters.push(`Search: ${truncate(qText, 40)}`)
      if (filters.length) {
        page.drawText(filters.join(' · '), { x: marginX, y: topY - 34, size: 9, font })
      }

      page.drawText(`Items: ${expenses.length}   Total: ${fmtMoneyEGP(total)}`, {
        x: marginX,
        y: topY - 50,
        size: 10,
        font: fontBold,
      })

      // Table header
      const headerY = topY - 74
      const headerSize = 10
      page.drawText('Date', { x: colDateX, y: headerY, size: headerSize, font: fontBold })
      page.drawText('Category', { x: colCatX, y: headerY, size: headerSize, font: fontBold })
      page.drawText('Payment', { x: colPayX, y: headerY, size: headerSize, font: fontBold })
      page.drawText('Amount', { x: colAmtX, y: headerY, size: headerSize, font: fontBold })
      page.drawText('Description', { x: colDescX, y: headerY, size: headerSize, font: fontBold })

      page.drawLine({
        start: { x: marginX, y: headerY - 4 },
        end: { x: width - marginX, y: headerY - 4 },
        thickness: 1,
        color: rgb(0.85, 0.85, 0.85),
      })

      // Page number
      page.drawText(`Page ${pageIndex}`, { x: width - marginX - 60, y: marginBottom - 10, size: 9, font })

      return headerY - 18
    }

    let page = pdfDoc.addPage(pageSize)
    let pageIndex = 1
    let y = drawHeader(page, pageIndex)

    const maxDescChars = 46
    const maxCatChars = 18

    for (const r of expenses) {
      const { width } = page.getSize()

      if (y < marginBottom + rowH) {
        page = pdfDoc.addPage(pageSize)
        pageIndex += 1
        y = drawHeader(page, pageIndex)
      }

      const key = r.category_key ?? ''
      const label = key ? labelByKey.get(key) ?? key : '—'

      const dateCell = fmtDate(r.date)
      const catCell = truncate(label, maxCatChars)
      const payCell = paymentLabel(r.payment_method)
      const amtCell = fmtMoneyEGP(Number(r.amount))
      const descCell = truncate(r.description ?? '', maxDescChars) || '—'

      page.drawText(dateCell, { x: colDateX, y, size: 9, font })
      page.drawText(catCell, { x: colCatX, y, size: 9, font })
      page.drawText(truncate(payCell, 14), { x: colPayX, y, size: 9, font })

      // Right align amount
      const amtWidth = font.widthOfTextAtSize(amtCell, 9)
      const amtRight = colDescX - 8
      page.drawText(amtCell, { x: Math.min(colAmtX, amtRight - amtWidth), y, size: 9, font })

      // Description (truncate)
      const descMaxWidth = width - marginX - colDescX
      // If long, still truncate by chars to keep stable.
      page.drawText(descCell, { x: colDescX, y, size: 9, font })

      y -= rowH
    }

    const bytes = await pdfDoc.save()

    const suffix = [
      payment_method && payment_method !== 'all' ? `_${payment_method}` : '',
      category && category !== 'all' ? `_${category}` : '',
      qText ? `_search` : '',
    ].join('')

    const filename = `expenses_${from}_to_${to}${suffix}.pdf`

    return new NextResponse(bytes, {
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
