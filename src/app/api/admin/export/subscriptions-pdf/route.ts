export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { PDFDocument, StandardFonts, rgb, type PDFPage } from 'pdf-lib'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { cairoRangeBoundsUTC, formatDateTimeInCairo } from '@/lib/cairoTime'
import { buildMonthlyRecognitionRows, subscriptionRecognitionNotes } from '@/lib/subscriptionRevenue'

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}
function isISODateOnly(s?: string | null) {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}
function formatEGP(n: number) {
  return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0)
}

type ProfileLite = { email: string | null; first_name: string | null; last_name: string | null }

function memberName(profile?: ProfileLite | null) {
  const name = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim()
  return name || profile?.email || 'Unknown member'
}

function lineClamp(s: string, max = 110) {
  const clean = (s || '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

export async function GET(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()
    const { data: auth } = await supa.auth.getUser()
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle<{ role: string | null }>()
    if (meErr) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message })
    if (!['admin', 'super_admin'].includes(me?.role ?? 'member')) return json(403, { ok: false, error: 'FORBIDDEN' })

    const { searchParams } = new URL(req.url)
    const from = searchParams.get('from') ?? ''
    const to = searchParams.get('to') ?? ''
    const view = (searchParams.get('view') ?? 'cash').toLowerCase() === 'recognized' ? 'recognized' : 'cash'
    if (!isISODateOnly(from) || !isISODateOnly(to) || from > to) {
      return json(400, { ok: false, error: 'INVALID_RANGE', hint: 'Use ?from=YYYY-MM-DD&to=YYYY-MM-DD with from ≤ to' })
    }

    const memberProfiles = new Map<string, ProfileLite>()
    async function hydrateProfiles(memberIds: string[]) {
      const uniqueIds = Array.from(new Set(memberIds.filter(Boolean)))
      if (uniqueIds.length === 0) return
      const { data: profs } = await supa.from('profiles').select('user_id, email, first_name, last_name').in('user_id', uniqueIds)
      for (const p of profs ?? []) memberProfiles.set(p.user_id, { email: p.email, first_name: p.first_name, last_name: p.last_name })
    }

    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)
    let page: PDFPage = pdf.addPage([842, 595])
    const height = 595
    const marginX = 32
    let y = height - 40

    const addPage = () => {
      page = pdf.addPage([842, 595])
      y = height - 40
    }

    const title = view === 'cash' ? 'Subscriptions export · Cash basis' : 'Subscriptions export · Monthly recognition'
    page.drawText(title, { x: marginX, y, size: 18, font: fontBold, color: rgb(0.05, 0.05, 0.05) })
    y -= 20
    page.drawText(`Range: ${from} → ${to}`, { x: marginX, y, size: 10, font, color: rgb(0.35, 0.35, 0.35) })
    y -= 14
    page.drawText(subscriptionRecognitionNotes(view), { x: marginX, y, size: 9, font, color: rgb(0.35, 0.35, 0.35) })
    y -= 18
    page.drawText(`Generated: ${formatDateTimeInCairo(new Date())}`, { x: marginX, y, size: 9, font, color: rgb(0.45, 0.45, 0.45) })
    y -= 18

    if (view === 'cash') {
      const { startISO, endISO } = cairoRangeBoundsUTC(from, to)
      const { data: subs, error } = await supa
        .from('subscriptions')
        .select('id, member_id, plan, subscription_type, status, start_date, end_date, amount, amount_due, paid_at, payment_method')
        .gte('paid_at', startISO)
        .lt('paid_at', endISO)
        .order('paid_at', { ascending: false })
        .limit(100000)
      if (error) return json(500, { ok: false, error: 'QUERY_FAILED', details: error.message })
      await hydrateProfiles((subs ?? []).map((r: any) => r.member_id).filter(Boolean))

      const total = (subs ?? []).reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0)
      page.drawText(`Rows: ${(subs ?? []).length} · Cash paid in range: ${formatEGP(total)}`, { x: marginX, y, size: 10, font: fontBold, color: rgb(0.1, 0.1, 0.1) })
      y -= 20

      for (const row of subs ?? []) {
        if (y < 56) addPage()
        const prof = row.member_id ? memberProfiles.get(row.member_id) : null
        const line = `${memberName(prof)} · ${row.plan ?? '—'} · Paid ${formatEGP(Number(row.amount ?? 0))} · Due ${formatEGP(Number(row.amount_due ?? 0))} · ${row.paid_at ? String(row.paid_at).slice(0, 10) : '—'}`
        page.drawText(lineClamp(line), { x: marginX, y, size: 10, font, color: rgb(0.08, 0.08, 0.08) })
        y -= 14
      }
    } else {
      const { data: subs, error } = await supa
        .from('subscriptions')
        .select('id, member_id, plan, subscription_type, status, start_date, end_date, amount, amount_due, paid_at, payment_method, frozen_from, frozen_until')
        .eq('subscription_type', 'time')
        .lte('start_date', to)
        .gte('end_date', from)
        .order('start_date', { ascending: true })
        .limit(100000)
      if (error) return json(500, { ok: false, error: 'QUERY_FAILED', details: error.message })
      await hydrateProfiles((subs ?? []).map((r: any) => r.member_id).filter(Boolean))
      const rows = buildMonthlyRecognitionRows((subs ?? []) as any, from, to)
      const total = rows.reduce((sum, row) => sum + row.recognized_amount, 0)
      page.drawText(`Rows: ${rows.length} · Recognized in range: ${formatEGP(total)}`, { x: marginX, y, size: 10, font: fontBold, color: rgb(0.1, 0.1, 0.1) })
      y -= 20

      for (const row of rows) {
        if (y < 56) addPage()
        const prof = row.member_id ? memberProfiles.get(row.member_id) : null
        const line = `${row.month} · ${memberName(prof)} · ${row.plan} · ${row.recognized_days}/${row.total_service_days} active days · ${formatEGP(row.recognized_amount)}`
        page.drawText(lineClamp(line), { x: marginX, y, size: 10, font, color: rgb(0.08, 0.08, 0.08) })
        y -= 14
      }
    }

    const bytes = await pdf.save()
    const filename = view === 'cash' ? `subscriptions_cash_basis_${from}_to_${to}.pdf` : `subscriptions_monthly_recognition_${from}_to_${to}.pdf`
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
