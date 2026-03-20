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
type RangeMode = 'day' | 'week' | 'month' | 'range'
type PersonalKind = 'advance_to_gym' | 'expense_paid_personally' | 'reimbursement_from_gym'

type PersonalEntry = {
  id: string
  entry_date: string
  person_id: string
  kind: PersonalKind
  amount: number
  payment_method: string | null
  note: string | null
  created_at: string
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

function personalKindLabel(kind: PersonalKind) {
  if (kind === 'advance_to_gym') return 'Advance to gym'
  if (kind === 'reimbursement_from_gym') return 'Reimbursement from gym'
  return 'Expense paid personally'
}

function personalCashEffectLabel(kind: PersonalKind) {
  if (kind === 'advance_to_gym') return 'Cash in'
  if (kind === 'reimbursement_from_gym') return 'Cash out'
  return 'Off-cash'
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
      .maybeSingle()

    if (meErr) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message })
    const role: Role = (me?.role as Role) ?? 'member'
    if (!['admin', 'super_admin'].includes(role)) return json(403, { ok: false, error: 'FORBIDDEN' })

    const admin = makeAdminClient()
    if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_MISSING' })

    const { searchParams } = new URL(req.url)
    const range = resolveRange(searchParams)

    const { data: pays, error: payErr } = await admin
      .from('subscription_payments')
      .select(
        'id, amount, payment_method, note, paid_at, created_at, member:profiles!subscription_payments_member_id_fkey(first_name,last_name,email,member_id)'
      )
      .gte('paid_at', range.startISO)
      .lt('paid_at', range.endISO)
      .order('paid_at', { ascending: false })
      .limit(10000)

    if (payErr) return json(500, { ok: false, error: 'PAYMENTS_QUERY_FAILED', details: payErr.message })

    const { data: exps, error: expErr } = await admin
      .from('expenses')
      .select('id, date, category_key, description, amount, payment_method')
      .gte('date', range.from)
      .lte('date', range.to)
      .limit(10000)

    if (expErr) return json(500, { ok: false, error: 'EXPENSES_QUERY_FAILED', details: expErr.message })

    const { data: rawPersonalEntries, error: pfErr } = await admin
      .from('personal_fund_entries')
      .select('id, entry_date, person_id, kind, amount, payment_method, note, created_at')
      .gte('entry_date', range.from)
      .lte('entry_date', range.to)
      .order('entry_date', { ascending: false })
      .limit(10000)

    const personalEntries = ((rawPersonalEntries ?? []) as any[]).filter(
      (row) => row.kind === 'advance_to_gym' || row.kind === 'expense_paid_personally' || row.kind === 'reimbursement_from_gym'
    ) as PersonalEntry[]

    const personIds = [...new Set(personalEntries.map((row) => row.person_id).filter(Boolean))]
    const { data: pfPeople } = personIds.length
      ? await admin.from('personal_fund_people').select('id,label').in('id', personIds)
      : { data: [] as Array<{ id: string; label: string }> }
    const personById = new Map(((pfPeople ?? []) as Array<{ id: string; label: string }>).map((row) => [row.id, row.label]))

    const subscriptionIncomeBy: Record<Method, number> = { cash: 0, instapay: 0, card: 0, bank_transfer: 0 }
    const businessExpenseBy: Record<Method, number> = { cash: 0, instapay: 0, card: 0, bank_transfer: 0 }
    const personalCashInBy: Record<Method, number> = { cash: 0, instapay: 0, card: 0, bank_transfer: 0 }
    const personalCashOutBy: Record<Method, number> = { cash: 0, instapay: 0, card: 0, bank_transfer: 0 }

    for (const r of (pays ?? []) as any[]) {
      const amt = Number(r.amount ?? 0)
      if (!Number.isFinite(amt)) continue
      subscriptionIncomeBy[normMethod(r.payment_method)] += amt
    }

    for (const r of (exps ?? []) as any[]) {
      const amt = Number(r.amount ?? 0)
      if (!Number.isFinite(amt)) continue
      businessExpenseBy[normMethod(r.payment_method)] += amt
    }

    for (const row of personalEntries) {
      const amt = Number(row.amount ?? 0)
      if (!Number.isFinite(amt)) continue
      const method = normMethod(row.payment_method)
      if (row.kind === 'advance_to_gym') personalCashInBy[method] += amt
      if (row.kind === 'reimbursement_from_gym') personalCashOutBy[method] += amt
    }

    const incomeBy: Record<Method, number> = { cash: 0, instapay: 0, card: 0, bank_transfer: 0 }
    const expenseBy: Record<Method, number> = { cash: 0, instapay: 0, card: 0, bank_transfer: 0 }
    for (const method of METHODS) {
      incomeBy[method] = subscriptionIncomeBy[method] + personalCashInBy[method]
      expenseBy[method] = businessExpenseBy[method] + personalCashOutBy[method]
    }

    const totalSubscriptionIncome = METHODS.reduce((sum, method) => sum + subscriptionIncomeBy[method], 0)
    const totalPersonalCashIn = METHODS.reduce((sum, method) => sum + personalCashInBy[method], 0)
    const totalIncome = METHODS.reduce((sum, method) => sum + incomeBy[method], 0)
    const totalBusinessExpenses = METHODS.reduce((sum, method) => sum + businessExpenseBy[method], 0)
    const totalPersonalCashOut = METHODS.reduce((sum, method) => sum + personalCashOutBy[method], 0)
    const totalExpenses = METHODS.reduce((sum, method) => sum + expenseBy[method], 0)
    const net = totalIncome - totalExpenses

    const recentPays = ((pays ?? []) as any[]).slice(0, 10)
    const topExpenses = (exps ?? [])
      .slice()
      .sort((a: any, b: any) => Number(b.amount ?? 0) - Number(a.amount ?? 0))
      .slice(0, 10)
    const personalCashMovements = personalEntries.filter((row) => row.kind !== 'expense_paid_personally').slice(0, 10)
    const personalOffCash = personalEntries.filter((row) => row.kind === 'expense_paid_personally').slice(0, 10)
    const personalOffCashTotal = personalEntries
      .filter((row) => row.kind === 'expense_paid_personally')
      .reduce((sum, row) => sum + Number(row.amount ?? 0), 0)

    const pdfDoc = await PDFDocument.create()
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

    const pageSize: [number, number] = [595.28, 841.89]
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

    const ensureSpace = (minHeight: number) => {
      if (y < marginBottom + minHeight) newPage()
    }

    const drawTitle = () => {
      page.drawText('Filtered Cash Report', { x: marginX, y, size: 18, font: fontBold })
      y -= 18
      page.drawText(range.label, { x: marginX, y, size: 10, font })
      y -= 14
      page.drawText(`Timezone: ${CAIRO_TZ}`, { x: marginX, y, size: 9, font, color: rgb(0.35, 0.35, 0.35) })
      y -= 12
      page.drawText('Includes Personal Funds cash in/out. Personal expenses paid personally remain off-cash context until reimbursement.', {
        x: marginX,
        y,
        size: 8.5,
        font,
        color: rgb(0.35, 0.35, 0.35),
      })
      y -= 14
      if (pfErr) {
        page.drawText(`Personal Funds status: unavailable fallback (${truncate(pfErr.message, 70)})`, {
          x: marginX,
          y,
          size: 8.5,
          font,
          color: rgb(0.7, 0.45, 0.05),
        })
        y -= 14
      }
      drawHLine(y)
      y -= 16
    }

    const drawSummary = () => {
      page.drawText(`Income: ${fmtMoneyEGP(totalIncome)}`, { x: marginX, y, size: 12, font: fontBold })
      page.drawText(`Expenses: ${fmtMoneyEGP(totalExpenses)}`, { x: marginX + 210, y, size: 12, font: fontBold })
      page.drawText(`Net cash: ${fmtMoneyEGP(net)}`, {
        x: marginX + 400,
        y,
        size: 12,
        font: fontBold,
        color: net < 0 ? rgb(0.8, 0.1, 0.1) : rgb(0.05, 0.5, 0.2),
      })
      y -= 18
      page.drawText(`Subscription income: ${fmtMoneyEGP(totalSubscriptionIncome)}   Personal Funds cash in: ${fmtMoneyEGP(totalPersonalCashIn)}`, {
        x: marginX,
        y,
        size: 9,
        font,
      })
      y -= 14
      page.drawText(`Business expenses: ${fmtMoneyEGP(totalBusinessExpenses)}   Personal Funds cash out: ${fmtMoneyEGP(totalPersonalCashOut)}`, {
        x: marginX,
        y,
        size: 9,
        font,
      })
      y -= 14
      page.drawText(`Personal expenses paid personally (off-cash context): ${fmtMoneyEGP(personalOffCashTotal)}`, {
        x: marginX,
        y,
        size: 9,
        font,
        color: rgb(0.35, 0.35, 0.35),
      })
      y -= 14
      page.drawText(
        `Filtered payments: ${(pays ?? []).length}   Filtered business expense lines: ${(exps ?? []).length}   PF cash movements: ${personalEntries.filter((row) => row.kind !== 'expense_paid_personally').length}   PF off-cash: ${personalEntries.filter((row) => row.kind === 'expense_paid_personally').length}`,
        {
          x: marginX,
          y,
          size: 8.5,
          font,
          color: rgb(0.35, 0.35, 0.35),
        }
      )
      y -= 16
    }

    const drawBreakdown = () => {
      ensureSpace(140)
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
        ensureSpace(40)
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
        y -= 11
        const parts = []
        if (personalCashInBy[m] > 0) parts.push(`PF in ${fmtMoneyEGP(personalCashInBy[m])}`)
        if (personalCashOutBy[m] > 0) parts.push(`PF out ${fmtMoneyEGP(personalCashOutBy[m])}`)
        if (parts.length) {
          page.drawText(parts.join(' · '), { x: colMethod + 20, y, size: 8, font, color: rgb(0.35, 0.35, 0.35) })
          y -= 11
        }
      }

      y -= 6
      drawHLine(y)
      y -= 18
    }

    const drawPaymentsTable = () => {
      ensureSpace(160)
      page.drawText('Subscription income (latest 10)', { x: marginX, y, size: 12, font: fontBold })
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
        ensureSpace(30)
        const memberName = `${r.member?.first_name ?? ''} ${r.member?.last_name ?? ''}`.trim() || r.member?.email || '—'
        page.drawText(truncate(fmtTimeCairo(r.paid_at || r.created_at), 18), { x: colWhen, y, size: 9, font })
        page.drawText(truncate(memberName, 28), { x: colMember, y, size: 9, font })
        page.drawText(labelMethod(normMethod(r.payment_method)), { x: colMethod, y, size: 9, font })
        page.drawText(fmtMoneyEGP(Number(r.amount ?? 0)), { x: colAmount, y, size: 9, font: fontBold })
        y -= rowH
      }

      if (!recentPays.length) {
        page.drawText('No subscription payments in this period.', { x: marginX, y, size: 9, font, color: rgb(0.35, 0.35, 0.35) })
        y -= rowH
      }

      y -= 6
      drawHLine(y)
      y -= 18
    }

    const drawExpensesTable = () => {
      ensureSpace(160)
      page.drawText('Top business expenses (highest 10)', { x: marginX, y, size: 12, font: fontBold })
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
        ensureSpace(30)
        page.drawText(fmtDate(String(r.date ?? '—')), { x: colDate, y, size: 9, font })
        page.drawText(truncate(String(r.category_key ?? '—'), 18), { x: colCat, y, size: 9, font })
        page.drawText(labelMethod(normMethod(r.payment_method)), { x: colMethod, y, size: 9, font })
        page.drawText(fmtMoneyEGP(Number(r.amount ?? 0)), { x: colAmount, y, size: 9, font: fontBold })
        page.drawText(truncate(String(r.description ?? ''), 18), { x: colDesc, y, size: 9, font })
        y -= rowH
      }

      if (!topExpenses.length) {
        page.drawText('No business expenses in this period.', { x: marginX, y, size: 9, font, color: rgb(0.35, 0.35, 0.35) })
        y -= rowH
      }

      y -= 6
      drawHLine(y)
      y -= 18
    }

    const drawPersonalCashTable = () => {
      ensureSpace(180)
      page.drawText('Personal Funds cash movements (latest 10)', { x: marginX, y, size: 12, font: fontBold })
      y -= 16

      const colDate = marginX
      const colPerson = marginX + 80
      const colType = marginX + 220
      const colMethod = marginX + 350
      const colAmount = marginX + 450

      page.drawText('Date', { x: colDate, y, size: 10, font: fontBold })
      page.drawText('Person', { x: colPerson, y, size: 10, font: fontBold })
      page.drawText('Type', { x: colType, y, size: 10, font: fontBold })
      page.drawText('Method', { x: colMethod, y, size: 10, font: fontBold })
      page.drawText('Amount', { x: colAmount, y, size: 10, font: fontBold })
      y -= 10
      drawHLine(y)
      y -= 12

      for (const row of personalCashMovements) {
        ensureSpace(34)
        page.drawText(fmtDate(row.entry_date), { x: colDate, y, size: 9, font })
        page.drawText(truncate(personById.get(row.person_id) ?? 'Unknown person', 20), { x: colPerson, y, size: 9, font })
        page.drawText(truncate(`${personalKindLabel(row.kind)} · ${personalCashEffectLabel(row.kind)}`, 24), { x: colType, y, size: 9, font })
        page.drawText(labelMethod(normMethod(row.payment_method)), { x: colMethod, y, size: 9, font })
        page.drawText(fmtMoneyEGP(Number(row.amount ?? 0)), { x: colAmount, y, size: 9, font: fontBold })
        y -= 11
        if (row.note) {
          page.drawText(truncate(row.note, 62), { x: colPerson, y, size: 8, font, color: rgb(0.35, 0.35, 0.35) })
          y -= 11
        }
      }

      if (!personalCashMovements.length) {
        page.drawText('No Personal Funds cash movements in this period.', { x: marginX, y, size: 9, font, color: rgb(0.35, 0.35, 0.35) })
        y -= rowH
      }

      y -= 6
      drawHLine(y)
      y -= 18
    }

    const drawPersonalOffCashTable = () => {
      ensureSpace(180)
      page.drawText('Personal expenses paid personally (latest 10 · off-cash)', { x: marginX, y, size: 12, font: fontBold })
      y -= 16

      const colDate = marginX
      const colPerson = marginX + 80
      const colMethod = marginX + 300
      const colAmount = marginX + 400
      const colNote = marginX + 470

      page.drawText('Date', { x: colDate, y, size: 10, font: fontBold })
      page.drawText('Person', { x: colPerson, y, size: 10, font: fontBold })
      page.drawText('Method', { x: colMethod, y, size: 10, font: fontBold })
      page.drawText('Amount', { x: colAmount, y, size: 10, font: fontBold })
      page.drawText('Note', { x: colNote, y, size: 10, font: fontBold })
      y -= 10
      drawHLine(y)
      y -= 12

      for (const row of personalOffCash) {
        ensureSpace(30)
        page.drawText(fmtDate(row.entry_date), { x: colDate, y, size: 9, font })
        page.drawText(truncate(personById.get(row.person_id) ?? 'Unknown person', 28), { x: colPerson, y, size: 9, font })
        page.drawText(labelMethod(normMethod(row.payment_method)), { x: colMethod, y, size: 9, font })
        page.drawText(fmtMoneyEGP(Number(row.amount ?? 0)), { x: colAmount, y, size: 9, font: fontBold })
        page.drawText(truncate(row.note ?? '', 18), { x: colNote, y, size: 9, font })
        y -= rowH
      }

      if (!personalOffCash.length) {
        page.drawText('No off-cash personal expenses in this period.', { x: marginX, y, size: 9, font, color: rgb(0.35, 0.35, 0.35) })
        y -= rowH
      }
    }

    drawTitle()
    drawSummary()
    drawBreakdown()
    drawPaymentsTable()
    drawExpensesTable()
    drawPersonalCashTable()
    drawPersonalOffCashTable()

    const pdfBytes = await pdfDoc.save()
    const filename = `cash-report_${range.from}_${range.to}.pdf`

    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: any) {
    return json(500, { ok: false, error: 'UNEXPECTED', details: String(e?.message || e) })
  }
}
