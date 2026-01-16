export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/apiAuth'
import { createSupabaseRSC } from '@/lib/supabaseServer'

type Role = 'member' | 'assistant_coach' | 'coach' | 'reception' | 'admin' | 'super_admin'

export async function GET() {
  const gate = await requireUser()
  if (!gate.ok) return gate.res

  const role = (gate.user.role as Role) || 'member'
  if (role !== 'super_admin') {
    return NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 })
  }

  const supabase = createSupabaseRSC()

  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, created_at')
    .order('created_at', { ascending: false })
    .limit(3)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, rows: data ?? [] })
}
