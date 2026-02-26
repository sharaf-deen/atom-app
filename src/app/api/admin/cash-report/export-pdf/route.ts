// src/app/api/admin/cash-report/export-pdf/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import {
  CAIRO_TZ,
  cairoMonthBoundsDateOnly,
  cairoRangeBoundsUTC,
  cairoTodayDateOnly,
  cairoWeekBoundsDateOnly,
  isISODateOnly,
} from '@/lib/cairoTime'

type Role = 'member' | 'assistant_coach' | 'coach' | 'reception' | 'admin' | 'super_admin'
type Method = 'cash' | 'instapay' | 'card' | 'bank_transfer'
const METHODS: Method[] = ['cash', 'instapay', 'card', 'bank_transfer']

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

function normMethod(m: any): Method {
  const s = String(m ?? 'cash')
  if (s === 'visa') return 'card'
  if (s === 'card') return 'card'
  if (s === 'instapay') return 'instapay'
  if (s === 'bank_transfer') return 'bank_transfer'
  return 'cash'
}

function labelMethod(m: Method) {
  if (m === 'cash') return 'Cash'
  if (m === 'instapay') return 'Instapay'
  if (m === 'card') return 'Card'
  return 'Bank transfer'
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
  const [y, m, d] = isoDateOnly.split('-').map((x) => Number(x))
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1))
  if (Number.isNaN(dt.getTime())) return isoDateOnly
  return dt.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })
}

function fmtTimeCairo(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      timeZone: CAIRO_TZ,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function truncate(s: string, max: number) {
  const t = (s || '').trim()
  if (t.length <= max) return t
  return t.slice(0, Math.max(0, max - 1)).trimEnd() + '…'
}

type RangeMode = 'day' | 'week' | 'month' | 'range'

function resolveRange(params: URLSearchParams): {
  mode: RangeMode
  anchorDate: string
  from: string
  to: string
  label: string
  startISO: string
  endISO: string
} {
  const today = cairoTodayDateOnly()
  const modeRaw = (params.get('mode') || 'day') as RangeMode
  const mode: RangeMode = modeRaw === 'week' || modeRaw === 'month' || modeRaw === 'range' ? modeRaw : 'day'

  const anchorDate = isISODateOnly(params.get('date')) ? (params.get('date') as string) : today
  const fromParam = isISODateOnly(params.get('from')) ? (params.get('from') as string) : today
  const toParam = isISODateOnly(params.get('to')) ? (params.get('to') as string) : fromParam

  const { from: weekFrom, to: weekTo } = cairoWeekBoundsDateOnly(anchorDate)
  const { from: monthFrom, to: monthTo } = cairoMonthBoundsDateOnly(anchorDate)

  const rFrom = mode === 'week' ? weekFrom : mode === 'month' ? monthFrom : mode === 'range' ? fromParam : anchorDate
  const rTo = mode === 'week' ? weekTo : mode === 'month' ? monthTo : mode === 'range' ? toParam : anchorDate
  const from = rFrom <= rTo ? rFrom : rTo
  const to = rFrom <= rTo ? rTo : rFrom

  const label =
    mode === 'day'
      ? `Day: ${from}`
      : mode === 'week'
      ? `Week (Mon–Sun): ${from} → ${to}`
      : mode === 'month'
      ? `Month: ${from.slice(0, 7)}`
      : `Range: ${from} → ${to}`

  const { startISO, endISO } = cairoRangeBoundsUTC(from, to)
  return { mode, anchorDate, from, to, label, startISO, endISO }
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
    const role: Role = (me?.role as Role) ?? 'member'
    if (!['admin', 'super_admin'].includes(role)) return json(403, { ok: false, error: 'FORBIDDEN' })

    const admin = makeAdminClient()
    if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_MISSING' })

    const { searchParams } = new URL(req.url)
    const range = resolveRange(searchParams)

    // Income from subscription_payments (created_at UTC bounds)
    const { data: pays, error: payErr } = await admin
      .from('subscription_payments')
      .select(
        'id, amount, payment_method, note, created_at, member:profiles!subscription_payments_member_id_fkey(first_name,last_name,email,member_id)'
      )
      .gte('created_at', range.startISO)
      .lt('created_at', range.endISO)
      .order('created_at', { ascending: false })
      .limit(10000)

    if (payErr) return json(500, { ok: false, error: 'PAYMENTS_QUERY_FAILED', details: payErr.message })

    const incomeBy: Record<Method, number> = { cash: 0, instapay: 0, card: 0, bank_transfer: 0 }
    for (const r of (pays ?? []) as any[]) {
      const amt = Number(r.amount ?? 0)
      if (!Number.isFinite(amt)) continue
      incomeBy[normMethod(r.payment_method)] += amt
    }

    // Expenses for Cairo date range (date-only)
    const { data: exps, error: expErr } = await admin
      .from('expenses')
      .select('id, date, category_key, description, amount, payment_method')
      .gte('date', range.from)
      .lte('date', range.to)
      .limit(10000)

    if (expErr) return json(500, { ok: false, error: 'EXPENSES_QUERY_FAILED', details: expErr.message })

    const expenseBy: Record<Method, number> = { cash: 0, instapay: 0, card: 0, bank_transfer: 0 }
    for (const r of (exps ?? []) as any[]) {
      const amt = Number(r.amount ?? 0)
      if (!Number.isFinite(amt)) continue
      expenseBy[normMethod(r.payment_method)] += amt
    }

    const totalIncome = METHODS.reduce((s, m) => s + incomeBy[m], 0)
    const totalExpenses = METHODS.reduce((s, m) => s + expenseBy[m], 0)
    const net = totalIncome - totalExpenses

    // Recent income (top 15)
    const recentPays = ((pays ?? []) as any[]).slice(0, 15)

    // Top expenses by amount (top 15)
    const topExpenses = (exps ?? [])
      .slice()
      .sort((a: any, b: any) => Number(b.amount ?? 0) - Number(a.amount ?? 0))
      .slice(0, 15)

    // --- PDF ---
    const pdfDoc = await PDFDocument.create()
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

    const pageSize: [number, number] = [595.28, 841.89] // A4
    const marginX = 40
    const marginTop = 46
    const marginBottom = 40
    const rowH = 14

    let page = pdfDoc.addPage(pageSize)
    let { width, height } = page.getSize()
    let y = height - marginTop

    const newPage = () => {
      page = pdfDoc.addPage(pageSize)
      ;({ width, height } = page.getSize())
      y = height - marginTop
    }

    const drawHLine = (yy: number) => {
      page.drawLine({
        start: { x: marginX, y: yy },
        end: { x: width - marginX, y: yy },
        thickness: 1,
        color: rgb(0.88, 0.88, 0.88),
      })
    }

    const drawTitle = () => {
      page.drawText('Cash Report', { x: marginX, y, size: 18, font: fontBold })
      y -= 18
      page.drawText(range.label, { x: marginX, y, size: 10, font })
      y -= 14
      page.drawText(`Timezone: ${CAIRO_TZ}`, { x: marginX, y, size: 9, font, color: rgb(0.35, 0.35, 0.35) })
      y -= 14
      drawHLine(y)
      y -= 16
    }

    const drawSummary = () => {
      page.drawText(`Income: ${fmtMoneyEGP(totalIncome)}`, { x: marginX, y, size: 12, font: fontBold })
      page.drawText(`Expenses: ${fmtMoneyEGP(totalExpenses)}`, { x: marginX + 220, y, size: 12, font: fontBold })
      page.drawText(`Net: ${fmtMoneyEGP(net)}`, {
        x: marginX + 430,
        y,
        size: 12,
        font: fontBold,
        color: net < 0 ? rgb(0.8, 0.1, 0.1) : rgb(0.05, 0.5, 0.2),
      })
      y -= 18
      page.drawText(`Payments: ${(pays ?? []).length}   Expenses: ${(exps ?? []).length}`, {
        x: marginX,
        y,
        size: 9,
        font,
        color: rgb(0.35, 0.35, 0.35),
      })
      y -= 16
    }

    const drawBreakdown = () => {
      page.drawText('Breakdown by payment method', { x: marginX, y, size: 12, font: fontBold })
      y -= 16

      const colMethod = marginX
      const colIncome = marginX + 140
      const colExpenses = marginX + 290
      const colNet = marginX + 440

      page.drawText('Method', { x: colMethod, y, size: 10, font: fontBold })
      page.drawText('Income', { x: colIncome, y, size: 10, font: fontBold })
      page.drawText('Expenses', { x: colExpenses, y, size: 10, font: fontBold })
      page.drawText('Net', { x: colNet, y, size: 10, font: fontBold })
      y -= 10
      drawHLine(y)
      y -= 12

      for (const m of METHODS) {
        if (y < marginBottom + 80) newPage()
        page.drawText(labelMethod(m), { x: colMethod, y, size: 10, font })
        page.drawText(fmtMoneyEGP(incomeBy[m]), { x: colIncome, y, size: 10, font })
        page.drawText(fmtMoneyEGP(expenseBy[m]), { x: colExpenses, y, size: 10, font })
        const v = incomeBy[m] - expenseBy[m]
        page.drawText(fmtMoneyEGP(v), {
          x: colNet,
          y,
          size: 10,
          font,
          color: v < 0 ? rgb(0.8, 0.1, 0.1) : rgb(0.05, 0.5, 0.2),
        })
        y -= rowH
      }

      y -= 6
      drawHLine(y)
      y -= 18
    }

    const drawPaymentsTable = () => {
      page.drawText('Recent income (payments)', { x: marginX, y, size: 12, font: fontBold })
      y -= 16

      const colWhen = marginX
      const colMember = marginX + 150
      const colMethod = marginX + 360
      const colAmount = marginX + 460

      page.drawText('When', { x: colWhen, y, size: 10, font: fontBold })
      page.drawText('Member', { x: colMember, y, size: 10, font: fontBold })
      page.drawText('Method', { x: colMethod, y, size: 10, font: fontBold })
      page.drawText('Amount', { x: colAmount, y, size: 10, font: fontBold })
      y -= 10
      drawHLine(y)
      y -= 12

      for (const r of recentPays) {
        if (y < marginBottom + 80) newPage()
        const memberName =
          `${r.member?.first_name ?? ''} ${r.member?.last_name ?? ''}`.trim() || r.member?.email || '—'
        page.drawText(truncate(fmtTimeCairo(r.created_at), 18), { x: colWhen, y, size: 9, font })
        page.drawText(truncate(memberName, 28), { x: colMember, y, size: 9, font })
        page.drawText(labelMethod(normMethod(r.payment_method)), { x: colMethod, y, size: 9, font })
        page.drawText(fmtMoneyEGP(Number(r.amount ?? 0)), { x: colAmount, y, size: 9, font: fontBold })
        y -= rowH
      }

      y -= 6
      drawHLine(y)
      y -= 18
    }

    const drawExpensesTable = () => {
      page.drawText('Top expenses (by amount)', { x: marginX, y, size: 12, font: fontBold })
      y -= 16

      const colDate = marginX
      const colCat = marginX + 80
      const colMethod = marginX + 250
      const colAmount = marginX + 350
      const colDesc = marginX + 430

      page.drawText('Date', { x: colDate, y, size: 10, font: fontBold })
      page.drawText('Category', { x: colCat, y, size: 10, font: fontBold })
      page.drawText('Method', { x: colMethod, y, size: 10, font: fontBold })
      page.drawText('Amount', { x: colAmount, y, size: 10, font: fontBold })
      page.drawText('Desc', { x: colDesc, y, size: 10, font: fontBold })
      y -= 10
      drawHLine(y)
      y -= 12

      for (const r of topExpenses as any[]) {
        if (y < marginBottom + 80) newPage()
        page.drawText(fmtDate(String(r.date ?? '—')), { x: colDate, y, size: 9, font })
        page.drawText(truncate(String(r.category_key ?? '—'), 18), { x: colCat, y, size: 9, font })
        page.drawText(labelMethod(normMethod(r.payment_method)), { x: colMethod, y, size: 9, font })
        page.drawText(fmtMoneyEGP(Number(r.amount ?? 0)), { x: colAmount, y, size: 9, font: fontBold })
        page.drawText(truncate(String(r.description ?? ''), 18), { x: colDesc, y, size: 9, font })
        y -= rowH
      }
    }

    drawTitle()
    drawSummary()
    drawBreakdown()
    drawPaymentsTable()
    drawExpensesTable()

    const pdfBytes = await pdfDoc.save()
    const filename = `cash-report_${range.from}_${range.to}.pdf`

    const res = new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
    return res
  } catch (e: any) {
    return json(500, { ok: false, error: 'UNEXPECTED', details: String(e?.message || e) })
  }
}
