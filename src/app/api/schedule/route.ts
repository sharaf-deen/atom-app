// src/app/api/schedule/route.ts
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseRouteClient } from '@/lib/supabaseRoute'

async function requireSuperAdmin(supabase: any) {
  const { data: authData, error: authErr } = await supabase.auth.getUser()
  if (authErr || !authData?.user) return { ok: false, status: 401, error: 'Unauthorized' }

  const uid = authData.user.id

  const { data: p, error: pErr } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', uid)
    .maybeSingle()

  const role = (p as any)?.role ?? null
  if (pErr || role !== 'super_admin') return { ok: false, status: 403, error: 'Forbidden' }

  return { ok: true, uid }
}

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store')
  return res
}

export async function GET(req: NextRequest) {
  const { supabase, applyCookies } = createSupabaseRouteClient(req)

  const { data: authData } = await supabase.auth.getUser()
  if (!authData?.user) return applyCookies(noStore(NextResponse.json({ error: 'Unauthorized' }, { status: 401 })))

  const { data, error } = await supabase
    .from('app_schedule')
    .select('key, content, updated_at')
    .eq('key', 'main')
    .maybeSingle()

  if (error) return applyCookies(noStore(NextResponse.json({ error: error.message }, { status: 500 })))

  return applyCookies(noStore(NextResponse.json({ schedule: data ?? null })))
}

export async function POST(req: NextRequest) {
  const { supabase, applyCookies } = createSupabaseRouteClient(req)

  const check = await requireSuperAdmin(supabase)
  if (!check.ok) return applyCookies(noStore(NextResponse.json({ error: check.error }, { status: check.status })))

  let body: any = null
  try {
    body = await req.json()
  } catch {
    body = null
  }

  const rawContent = body?.content
  if (typeof rawContent !== 'string') {
    return applyCookies(noStore(NextResponse.json({ error: 'Missing content' }, { status: 400 })))
  }

  const content = rawContent.trim()
  if (!content) return applyCookies(noStore(NextResponse.json({ error: 'Missing content' }, { status: 400 })))
  if (content.length > 50_000) return applyCookies(noStore(NextResponse.json({ error: 'Content too large' }, { status: 400 })))

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('app_schedule')
    .upsert({ key: 'main', content, updated_at: now, updated_by: check.uid }, { onConflict: 'key' })

  if (error) return applyCookies(noStore(NextResponse.json({ error: error.message }, { status: 500 })))

  return applyCookies(noStore(NextResponse.json({ ok: true })))
}
