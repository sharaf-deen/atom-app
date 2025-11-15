// src/app/api/admin/export/attendance/route.ts
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'


function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}
function isISODateOnly(s?: string | null) {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}
function csvCell(v: any) {
  const s = v === null || v === undefined ? '' : String(v)
  return `"${s.replace(/"/g, '""')}"`
}

export async function GET(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    // Auth
    const { data: auth } = await supa.auth.getUser()
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    // Only admin / super_admin
    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle<{ role: string | null }>()
    if (meErr) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message })
    if (!['admin', 'super_admin'].includes(me?.role ?? 'member')) {
      return json(403, { ok: false, error: 'FORBIDDEN' })
    }

    const { searchParams } = new URL(req.url)
    const from = searchParams.get('from') ?? ''
    const to = searchParams.get('to') ?? ''
    if (!isISODateOnly(from) || !isISODateOnly(to) || from > to) {
      return json(400, { ok: false, error: 'INVALID_RANGE', hint: 'Use ?from=YYYY-MM-DD&to=YYYY-MM-DD with from ≤ to' })
    }

    // Filter on attendance.date (inclusive range)
    const { data: rows, error: qErr } = await supa
      .from('attendance')
      .select('id, member_id, date, valid, from_sessions, subscription_id')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false })
      .limit(100000)
    if (qErr) return json(500, { ok: false, error: 'QUERY_FAILED', details: qErr.message })

    const memberIds = Array.from(new Set((rows ?? []).map((r: any) => r.member_id).filter(Boolean)))
    let profilesMap = new Map<string, { email: string | null; first_name: string | null; last_name: string | null }>()
    if (memberIds.length > 0) {
      const { data: profs } = await supa
        .from('profiles')
        .select('user_id, email, first_name, last_name')
        .in('user_id', memberIds)
      for (const p of profs ?? []) {
        profilesMap.set(p.user_id, { email: p.email, first_name: p.first_name, last_name: p.last_name })
      }
    }

    const header = [
      'id','member_id','member_email','first_name','last_name',
      'date','valid','from_sessions','subscription_id'
    ]
    const lines = [header.map(csvCell).join(',')]

    for (const r of rows ?? []) {
      const prof = profilesMap.get(r.member_id) ?? { email: null, first_name: null, last_name: null }
      lines.push([
        prof.email,
        prof.first_name,
        prof.last_name,
        r.date,
        r.valid,
        r.from_sessions,
        r.subscription_id,
      ].map(csvCell).join(','))
    }

    const csv = lines.join('\r\n')
    const filename = `attendance_${from}_to_${to}.csv`
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
