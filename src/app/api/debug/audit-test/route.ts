export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/apiAuth'
import { createSupabaseRSC } from '@/lib/supabaseServer'

export async function GET() {
  const gate = await requireUser()
  if (!gate.ok) return gate.res

  const supabase = createSupabaseRSC()

  const { data, error } = await supabase
    .from('audit_logs')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(3)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 403 })
  }

  return NextResponse.json({ ok: true, rows: data ?? [] })
}
