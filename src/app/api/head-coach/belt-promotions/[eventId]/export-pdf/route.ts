export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

type AudienceFilter = 'all' | 'kids' | 'adults'
type PromotionFilter = 'all' | 'stripe' | 'belt'
type ExportScope = 'applied' | 'confirmed'
type EventAudience = 'kids' | 'adults' | 'mixed'
type AgeGroup = 'kids' | 'adults' | 'unknown'
type PromotionDecision = 'stripe' | 'belt' | 'none'

type EventRow = {
  id: string
  title: string
  event_date: string
  event_time: string | null
  audience: EventAudience
  status: string
}

type CandidateRow = {
  id: string
  member_user_id: string
  current_belt: string | null
  current_stripes: number | null
  proposed_decision: PromotionDecision
  proposed_belt: string | null
  proposed_stripes: number | null
  final_decision: string
  results_applied_at: string | null
  sort_order: number | null
}

type RosterRow = {
  user_id: string
  member_id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  date_of_birth: string | null
}

type ExportRow = CandidateRow & {
  athlete_name: string
  member_id: string | null
  age_group: AgeGroup
}

function json(status: number, body: unknown) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient<any>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function normalizeUuid(value: unknown) {
  const raw = typeof value === 'string' ? value.trim() : ''
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
    ? raw
    : ''
}

function normalizeAudience(value: string | null): AudienceFilter {
  return value === 'kids' || value === 'adults' ? value : 'all'
}

function normalizePromotion(value: string | null): PromotionFilter {
  return value === 'stripe' || value === 'belt' ? value : 'all'
}

function normalizeScope(value: string | null): ExportScope {
  return value === 'confirmed' ? 'confirmed' : 'applied'
}

function titleCase(value: string | null | undefined) {
  return String(value ?? '')
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function fullName(row?: RosterRow | null) {
  if (!row) return 'Unknown athlete'
  const joined = [row.first_name ?? '', row.last_name ?? ''].join(' ').trim()
  return joined || row.email || row.member_id || 'Unknown athlete'
}

function ageGroupAtDate(dateOfBirth: string | null, eventDate: string, fallback: EventAudience): AgeGroup {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    const [birthYear, birthMonth, birthDay] = String(dateOfBirth).split('-').map(Number)
    const [eventYear, eventMonth, eventDay] = eventDate.split('-').map(Number)
    let age = eventYear - birthYear
    if (eventMonth < birthMonth || (eventMonth === birthMonth && eventDay < birthDay)) age -= 1
    if (age >= 0) return age < 16 ? 'kids' : 'adults'
  }
  if (fallback === 'kids' || fallback === 'adults') return fallback
  return 'unknown'
}

function safePdfText(value: unknown) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
}

function truncate(value: unknown, max: number) {
  const text = safePdfText(value).trim()
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...`
}

function formatDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return safePdfText(value)
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function currentRankLabel(row: ExportRow) {
  const stripes = Math.max(0, Math.min(4, Number(row.current_stripes ?? 0)))
  const explicitBelt = String(row.current_belt ?? '').trim()
  const belt = explicitBelt || (stripes > 0 ? 'white' : '')
  if (!belt) return stripes > 0 ? `${stripes} stripes` : 'Not recorded'
  return `${titleCase(belt)} ${stripes} stripe${stripes === 1 ? '' : 's'}`
}

function promotionLabel(row: ExportRow) {
  if (row.proposed_decision === 'belt') {
    return row.proposed_belt ? `${titleCase(row.proposed_belt)} Belt` : 'Belt promotion'
  }
  if (row.proposed_decision === 'stripe') {
    const stripes = Math.max(0, Math.min(4, Number(row.proposed_stripes ?? 0)))
    const belt = String(row.current_belt ?? '').trim() || (Number(row.current_stripes ?? 0) > 0 ? 'white' : '')
    return belt ? `${titleCase(belt)} - Stripe ${stripes}` : `Stripe ${stripes}`
  }
  return 'No promotion'
}

function safeFilenamePart(value: string) {
  const clean = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
  return clean || 'ceremony'
}

function audienceLabel(value: AudienceFilter) {
  if (value === 'kids') return 'Kids'
  if (value === 'adults') return 'Adults'
  return 'Kids + Adults'
}

function promotionFilterLabel(value: PromotionFilter) {
  if (value === 'stripe') return 'Stripes only'
  if (value === 'belt') return 'Belts only'
  return 'Belts + Stripes'
}

function scopeLabel(value: ExportScope) {
  return value === 'applied' ? 'Applied results only' : 'Confirmed results'
}

function groupLabel(ageGroup: AgeGroup, decision: PromotionDecision) {
  const age = ageGroup === 'kids' ? 'Kids' : ageGroup === 'adults' ? 'Adults' : 'Age unknown'
  const promotion = decision === 'belt' ? 'Belt promotions' : 'Stripe promotions'
  return `${age} - ${promotion}`
}

export async function GET(
  req: Request,
  ctx: { params: { eventId: string } },
) {
  try {
    const eventId = normalizeUuid(ctx?.params?.eventId)
    if (!eventId) return json(400, { ok: false, error: 'INVALID_EVENT_ID' })

    const supabase = createSupabaseServerActionClient()
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle<{ role: string | null }>()

    if (profileError) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: profileError.message })
    if (profile?.role !== 'head_coach' && profile?.role !== 'super_admin') {
      return json(403, { ok: false, error: 'FORBIDDEN' })
    }

    const admin = makeAdminClient()
    if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_MISSING' })

    const { searchParams } = new URL(req.url)
    const audience = normalizeAudience(searchParams.get('audience'))
    const promotion = normalizePromotion(searchParams.get('promotion'))
    const scope = normalizeScope(searchParams.get('scope'))

    const [eventResult, candidatesResult] = await Promise.all([
      admin
        .from('belt_promotion_events')
        .select('id,title,event_date,event_time,audience,status')
        .eq('id', eventId)
        .maybeSingle<EventRow>(),
      admin
        .from('belt_promotion_event_candidates')
        .select('id,member_user_id,current_belt,current_stripes,proposed_decision,proposed_belt,proposed_stripes,final_decision,results_applied_at,sort_order')
        .eq('event_id', eventId)
        .eq('final_decision', 'confirmed')
        .order('sort_order', { ascending: true })
        .returns<CandidateRow[]>(),
    ])

    if (eventResult.error) return json(500, { ok: false, error: 'EVENT_LOOKUP_FAILED', details: eventResult.error.message })
    if (!eventResult.data) return json(404, { ok: false, error: 'EVENT_NOT_FOUND' })
    if (candidatesResult.error) return json(500, { ok: false, error: 'CANDIDATES_LOOKUP_FAILED', details: candidatesResult.error.message })

    const event = eventResult.data
    const candidates = (candidatesResult.data ?? []).filter((row) => {
      if (row.proposed_decision !== 'stripe' && row.proposed_decision !== 'belt') return false
      if (scope === 'applied' && !row.results_applied_at) return false
      if (promotion !== 'all' && row.proposed_decision !== promotion) return false
      return true
    })

    const memberIds = [...new Set(candidates.map((row) => row.member_user_id).filter(Boolean))]
    let rosterRows: RosterRow[] = []
    if (memberIds.length) {
      const rosterResult = await admin
        .from('head_coach_athlete_roster')
        .select('user_id,member_id,first_name,last_name,email,date_of_birth')
        .in('user_id', memberIds)
        .returns<RosterRow[]>()
      if (rosterResult.error) return json(500, { ok: false, error: 'ROSTER_LOOKUP_FAILED', details: rosterResult.error.message })
      rosterRows = rosterResult.data ?? []
    }

    const rosterById = new Map(rosterRows.map((row) => [row.user_id, row]))
    const rows = candidates
      .map<ExportRow>((candidate) => {
        const roster = rosterById.get(candidate.member_user_id) ?? null
        return {
          ...candidate,
          athlete_name: fullName(roster),
          member_id: roster?.member_id ?? null,
          age_group: ageGroupAtDate(roster?.date_of_birth ?? null, event.event_date, event.audience),
        }
      })
      .filter((row) => audience === 'all' || row.age_group === audience)
      .sort((a, b) => {
        const ageRank = { kids: 0, adults: 1, unknown: 2 } as const
        const decisionRank = { belt: 0, stripe: 1, none: 2 } as const
        const ageDiff = ageRank[a.age_group] - ageRank[b.age_group]
        if (ageDiff !== 0) return ageDiff
        const decisionDiff = decisionRank[a.proposed_decision] - decisionRank[b.proposed_decision]
        if (decisionDiff !== 0) return decisionDiff
        const sortDiff = Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)
        if (sortDiff !== 0) return sortDiff
        return a.athlete_name.localeCompare(b.athlete_name)
      })

    const pdfDoc = await PDFDocument.create()
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
    const pageSize: [number, number] = [595.28, 841.89]
    const marginX = 30
    const marginTop = 38
    const marginBottom = 36
    const rowHeight = 18

    let page = pdfDoc.addPage(pageSize)
    let { width, height } = page.getSize()
    let y = height - marginTop

    const addPage = () => {
      page = pdfDoc.addPage(pageSize)
      ;({ width, height } = page.getSize())
      y = height - marginTop
      drawPageHeader()
    }

    const drawRule = (yy: number) => {
      page.drawLine({
        start: { x: marginX, y: yy },
        end: { x: width - marginX, y: yy },
        thickness: 0.8,
        color: rgb(0.86, 0.86, 0.86),
      })
    }

    const ensureSpace = (space: number) => {
      if (y < marginBottom + space) addPage()
    }

    const drawPageHeader = () => {
      page.drawText('ATOM Jiu-Jitsu', { x: marginX, y, size: 16, font: fontBold })
      y -= 19
      page.drawText(truncate(event.title, 70), { x: marginX, y, size: 12, font: fontBold })
      y -= 15
      page.drawText(`${formatDate(event.event_date)}${event.event_time ? ` - ${safePdfText(event.event_time)}` : ''}`, {
        x: marginX,
        y,
        size: 9.5,
        font,
        color: rgb(0.35, 0.35, 0.35),
      })
      y -= 14
      page.drawText(`${audienceLabel(audience)} | ${promotionFilterLabel(promotion)} | ${scopeLabel(scope)}`, {
        x: marginX,
        y,
        size: 9,
        font,
        color: rgb(0.35, 0.35, 0.35),
      })
      y -= 12
      drawRule(y)
      y -= 14
    }

    const drawTableHeader = () => {
      const cols = [marginX, marginX + 24, marginX + 205, marginX + 310, marginX + 430]
      page.drawText('#', { x: cols[0], y, size: 8, font: fontBold })
      page.drawText('Athlete', { x: cols[1], y, size: 8, font: fontBold })
      page.drawText('Member ID', { x: cols[2], y, size: 8, font: fontBold })
      page.drawText('Previous', { x: cols[3], y, size: 8, font: fontBold })
      page.drawText('Promotion', { x: cols[4], y, size: 8, font: fontBold })
      y -= 8
      drawRule(y)
      y -= 11
    }

    drawPageHeader()

    page.drawText(`Promoted athletes: ${rows.length}`, { x: marginX, y, size: 11, font: fontBold })
    const beltCount = rows.filter((row) => row.proposed_decision === 'belt').length
    const stripeCount = rows.filter((row) => row.proposed_decision === 'stripe').length
    page.drawText(`Belts: ${beltCount}   Stripes: ${stripeCount}`, {
      x: marginX + 180,
      y,
      size: 10,
      font,
      color: rgb(0.3, 0.3, 0.3),
    })
    y -= 22

    const groupOrder: Array<[AgeGroup, PromotionDecision]> = [
      ['kids', 'belt'],
      ['kids', 'stripe'],
      ['adults', 'belt'],
      ['adults', 'stripe'],
      ['unknown', 'belt'],
      ['unknown', 'stripe'],
    ]

    if (rows.length === 0) {
      page.drawText('No matching promoted athletes for these filters.', {
        x: marginX,
        y,
        size: 10,
        font,
        color: rgb(0.35, 0.35, 0.35),
      })
      y -= 18
    } else {
      let overallIndex = 1
      for (const [ageGroup, decision] of groupOrder) {
        const groupRows = rows.filter((row) => row.age_group === ageGroup && row.proposed_decision === decision)
        if (!groupRows.length) continue

        ensureSpace(70)
        page.drawText(`${groupLabel(ageGroup, decision)} (${groupRows.length})`, {
          x: marginX,
          y,
          size: 11,
          font: fontBold,
        })
        y -= 17
        drawTableHeader()

        for (const row of groupRows) {
          ensureSpace(rowHeight + 8)
          const cols = [marginX, marginX + 24, marginX + 205, marginX + 310, marginX + 430]
          page.drawText(String(overallIndex), { x: cols[0], y, size: 8.5, font })
          page.drawText(truncate(row.athlete_name, 29), { x: cols[1], y, size: 8.5, font: fontBold })
          page.drawText(truncate(row.member_id || '-', 16), { x: cols[2], y, size: 8.5, font })
          page.drawText(truncate(currentRankLabel(row), 20), { x: cols[3], y, size: 8.5, font })
          page.drawText(truncate(promotionLabel(row), 20), { x: cols[4], y, size: 8.5, font: fontBold })
          y -= rowHeight
          overallIndex += 1
        }

        y -= 8
      }
    }

    ensureSpace(42)
    drawRule(y)
    y -= 14
    const generatedAt = new Date().toLocaleString('en-GB', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    page.drawText(`Generated ${safePdfText(generatedAt)} - Head Coach / Super Admin export`, {
      x: marginX,
      y,
      size: 8,
      font,
      color: rgb(0.45, 0.45, 0.45),
    })

    const pages = pdfDoc.getPages()
    pages.forEach((pdfPage, index) => {
      const footer = `Page ${index + 1} / ${pages.length}`
      pdfPage.drawText(footer, {
        x: width - marginX - font.widthOfTextAtSize(footer, 8),
        y: 18,
        size: 8,
        font,
        color: rgb(0.45, 0.45, 0.45),
      })
    })

    const bytes = await pdfDoc.save()
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const filename = [
      'ATOM_Promotion',
      event.event_date,
      safeFilenamePart(event.title),
      audience,
      promotion,
      scope,
    ].join('_') + '.pdf'

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store, private',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error: any) {
    return json(500, {
      ok: false,
      error: 'SERVER_ERROR',
      details: error?.message ?? String(error),
    })
  }
}
