// src/app/api/admin/payments/export-pdf/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { addDaysDateOnly, cairoDayBoundsUTC, isISODateOnly } from '@/lib/cairoTime'

type Role = 'member' | 'assistant_coach' | 'coach' | 'reception' | 'admin' | 'super_admin'

type ExportPaymentRow = {
  id: string
  subscription_id: string
  member_id: string
  amount: number
  payment_method: string | null
  note: string | null
  paid_at: string | null
  created_at: string | null
  member: {
    member_id: string | null
    email: string | null
    first_name: string | null
    last_name: string | null
    phone: string | null
  } | null
  actor: {
    email: string | null
    first_name: string | null
    last_name: string | null
  } | null
}

const IMPOSSIBLE_MEMBER_ID = '00000000-0000-0000-0000-000000000000'

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function sanitizeSearch(v: string) {
  return (v || '').replace(/[%,_]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

function paymentLabel(v?: string | null) {
  if (!v) return 'Cash'
  if (v === 'cash') return 'Cash'
  if (v === 'instapay') return 'Instapay'
  if (v === 'card' || v === 'visa') return 'Card'
  if (v === 'bank_transfer') return 'Bank transfer'
  return v
}

function formatEGP(n: number) {
  const v = Number.isFinite(n) ? n : 0
  return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format(v)
}

function formatCairoDateTime(iso?: string | null) {
  const raw = String(iso ?? '').trim()
  if (!raw) return '—'
  const dt = new Date(raw)
  if (Number.isNaN(dt.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(dt)
}

function fmtDateOnly(isoDateOnly: string) {
  const [y, m, d] = isoDateOnly.split('-').map((x) => Number(x))
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1))
  if (Number.isNaN(dt.getTime())) return isoDateOnly
  return dt.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })
}

function truncate(s: string, max: number) {
  const t = (s || '').trim()
  if (t.length <= max) return t
  return t.slice(0, Math.max(0, max - 1)).trimEnd() + '…'
}

function applyPaymentMethodFilter<T extends { eq: Function; in: Function }>(query: T, method: string) {
  if (!method || method === 'all') return query
  if (method === 'card') return query.in('payment_method', ['card', 'visa'])
  return query.eq('payment_method', method)
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
    if (!['admin', 'super_admin'].includes((me?.role as Role) ?? 'member')) return json(403, { ok: false, error: 'FORBIDDEN' })

    const admin = makeAdminClient()
    if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_MISSING' })

    const { searchParams } = new URL(req.url)
    const from = searchParams.get('from') ?? ''
    const to = searchParams.get('to') ?? ''
    const payment_method = searchParams.get('payment_method') ?? 'all'
    const qRaw = searchParams.get('q') ?? ''
    const qText = sanitizeSearch(qRaw)

    if (!isISODateOnly(from) || !isISODateOnly(to) || from > to) {
      return json(400, { ok: false, error: 'INVALID_RANGE', hint: 'Use ?from=YYYY-MM-DD&to=YYYY-MM-DD with from ≤ to' })
    }

    const allowedMethods = new Set(['all', 'cash', 'instapay', 'card', 'bank_transfer'])
    if (!allowedMethods.has(payment_method)) {
      return json(400, { ok: false, error: 'INVALID_PAYMENT_METHOD' })
    }

    let memberIds: string[] | null = null
    if (qText) {
      const like = `%${qText}%`
      const { data: profs } = await admin
        .from('profiles')
        .select('user_id')
        .or(
          `email.ilike.${like},first_name.ilike.${like},last_name.ilike.${like},phone.ilike.${like},member_id.ilike.${like}`
        )
        .limit(200)

      memberIds = (profs ?? []).map((p: any) => p.user_id).filter(Boolean)
      if (!memberIds.length) memberIds = []
    }

    const startISO = cairoDayBoundsUTC(from).startISO
    const endISO = cairoDayBoundsUTC(addDaysDateOnly(to, 1)).startISO

    let query = admin
      .from('subscription_payments')
      .select(
        'id, subscription_id, member_id, amount, payment_method, note, paid_at, created_at, member:profiles!subscription_payments_member_id_fkey(member_id,email,first_name,last_name,phone), actor:profiles!subscription_payments_created_by_fkey(email,first_name,last_name)'
      )
      .gte('paid_at', startISO)
      .lt('paid_at', endISO)
      .order('paid_at', { ascending: false })
      .limit(100000)

    query = applyPaymentMethodFilter(query as any, payment_method) as any
    if (memberIds) {
      if (!memberIds.length) query = query.in('member_id', [IMPOSSIBLE_MEMBER_ID])
      else query = query.in('member_id', memberIds)
    }

    const { data: rows, error: qErr } = await query
    if (qErr) return json(500, { ok: false, error: 'QUERY_FAILED', details: qErr.message })

    const payments = ((rows ?? []) as any[]).map((r) => ({
      id: String(r.id),
      subscription_id: String(r.subscription_id),
      member_id: String(r.member_id),
      amount: Number(r.amount ?? 0),
      payment_method: r.payment_method ?? null,
      note: r.note ?? null,
      paid_at: r.paid_at ?? null,
      created_at: r.created_at ?? null,
      member: r.member ?? null,
      actor: r.actor ?? null,
    })) as ExportPaymentRow[]

    const totals = { all: 0, cash: 0, instapay: 0, card: 0, bank_transfer: 0 }
    for (const r of payments) {
      const amt = Number(r.amount ?? 0)
      if (!Number.isFinite(amt)) continue
      totals.all += amt
      const method = String(r.payment_method ?? 'cash')
      if (method === 'cash') totals.cash += amt
      else if (method === 'instapay') totals.instapay += amt
      else if (method === 'card' || method === 'visa') totals.card += amt
      else if (method === 'bank_transfer') totals.bank_transfer += amt
    }

    const pdfDoc = await PDFDocument.create()
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

    const pageSize: [number, number] = [841.89, 595.28]
    const marginX = 28
    const marginTop = 30
    const marginBottom = 24
    const rowH = 14

    const colPaidX = marginX
    const colMemberX = colPaidX + 92
    const colAmtX = colMemberX + 210
    const colMethodX = colAmtX + 78
    const colNoteX = colMethodX + 74
    const colByX = colNoteX + 170

    const drawHeader = (page: any, pageIndex: number) => {
      const { width, height } = page.getSize()
      const topY = height - marginTop

      page.drawText('Filtered Payments Export', { x: marginX, y: topY, size: 18, font: fontBold })
      page.drawText(`Range: ${fmtDateOnly(from)} → ${fmtDateOnly(to)}`, { x: marginX, y: topY - 18, size: 10, font })

      const filters: string[] = []
      if (payment_method !== 'all') filters.push(`Method: ${paymentLabel(payment_method)}`)
      if (qText) filters.push(`Search: ${truncate(qText, 44)}`)
      if (filters.length) {
        page.drawText(filters.join(' · '), { x: marginX, y: topY - 32, size: 9, font })
      }

      page.drawText(`Items: ${payments.length}   Total: ${formatEGP(totals.all)}`, { x: marginX, y: topY - 46, size: 10, font: fontBold })
      page.drawText(
        `Cash: ${formatEGP(totals.cash)}   Instapay: ${formatEGP(totals.instapay)}   Card: ${formatEGP(totals.card)}   Bank: ${formatEGP(totals.bank_transfer)}`,
        { x: marginX, y: topY - 60, size: 8, font }
      )

      const headerY = topY - 84
      page.drawText('Paid at (EG)', { x: colPaidX, y: headerY, size: 10, font: fontBold })
      page.drawText('Member', { x: colMemberX, y: headerY, size: 10, font: fontBold })
      page.drawText('Amount', { x: colAmtX, y: headerY, size: 10, font: fontBold })
      page.drawText('Method', { x: colMethodX, y: headerY, size: 10, font: fontBold })
      page.drawText('Note', { x: colNoteX, y: headerY, size: 10, font: fontBold })
      page.drawText('By', { x: colByX, y: headerY, size: 10, font: fontBold })

      page.drawLine({
        start: { x: marginX, y: headerY - 4 },
        end: { x: width - marginX, y: headerY - 4 },
        thickness: 1,
        color: rgb(0.85, 0.85, 0.85),
      })

      page.drawText(`Page ${pageIndex}`, { x: width - marginX - 44, y: marginBottom - 8, size: 9, font })
      return headerY - 18
    }

    let page = pdfDoc.addPage(pageSize)
    let pageIndex = 1
    let y = drawHeader(page, pageIndex)

    for (const r of payments) {
      if (y <= marginBottom + 18) {
        page = pdfDoc.addPage(pageSize)
        pageIndex += 1
        y = drawHeader(page, pageIndex)
      }

      const memberName = `${r.member?.first_name ?? ''} ${r.member?.last_name ?? ''}`.trim() || r.member?.email || '—'
      const memberLabel = r.member?.member_id ? `${memberName} · ${r.member.member_id}` : memberName
      const actorName = `${r.actor?.first_name ?? ''} ${r.actor?.last_name ?? ''}`.trim() || r.actor?.email || '—'

      page.drawText(truncate(formatCairoDateTime(r.paid_at ?? r.created_at), 18), { x: colPaidX, y, size: 8, font })
      page.drawText(truncate(memberLabel, 38), { x: colMemberX, y, size: 8, font })
      page.drawText(truncate(formatEGP(Number(r.amount ?? 0)), 14), { x: colAmtX, y, size: 8, font: fontBold })
      page.drawText(truncate(paymentLabel(r.payment_method), 12), { x: colMethodX, y, size: 8, font })
      page.drawText(truncate(r.note ?? '—', 30), { x: colNoteX, y, size: 8, font })
      page.drawText(truncate(actorName, 18), { x: colByX, y, size: 8, font })

      y -= rowH
    }

    const pdfBytes = await pdfDoc.save()
    const filename = `payments_${from}_to_${to}.pdf`

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
