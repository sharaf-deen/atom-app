export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { loadActiveMemberProgramOptions } from '@/lib/memberPrograms'

const ALLOWED = new Set(['reception', 'admin', 'super_admin', 'head_coach'])

export async function GET() {
  const me = await getSessionUser()
  if (!me) {
    return NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 })
  }
  if (!ALLOWED.has(String(me.role ?? ''))) {
    return NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 })
  }

  try {
    const admin = createSupabaseAdminClient()
    const programs = await loadActiveMemberProgramOptions(admin)
    return NextResponse.json({ ok: true, programs }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: 'PROGRAM_OPTIONS_FAILED', details: error instanceof Error ? error.message : String(error) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
