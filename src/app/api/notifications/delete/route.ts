export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient<any>(url, key, { auth: { persistSession: false } })
}

function uniqIds(ids: any): string[] {
  const out: string[] = []
  const set = new Set<string>()
  if (!Array.isArray(ids)) return out
  for (const x of ids) {
    const s = String(x || '').trim()
    if (!s) continue
    if (set.has(s)) continue
    set.add(s)
    out.push(s)
  }
  return out
}

type Scope = 'inbox' | 'sent'

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) return json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const admin = makeAdminClient()
    if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_MISSING' })

    let body: any = null
    try {
      body = await req.json()
    } catch {
      body = null
    }

    const ids = uniqIds(body?.ids)
    if (ids.length === 0) return json(400, { ok: false, error: 'MISSING_IDS' })
    if (ids.length > 200) return json(400, { ok: false, error: 'TOO_MANY_IDS' })

    const scopeRaw = String(body?.scope || body?.box || body?.target || 'inbox').trim().toLowerCase()
    const scope: Scope = scopeRaw === 'sent' ? 'sent' : 'inbox'

    const now = new Date().toISOString()

    if (scope === 'sent') {
      // Soft-delete for the SENDER (created_by)
      const { data, error } = await admin
        .from('notifications')
        .update({ deleted_for_sender_at: now })
        .in('id', ids)
        .eq('created_by', auth.user.id)
        .select('id')

      if (error) return json(500, { ok: false, error: 'UPDATE_FAILED', details: error.message })

      return json(200, {
        ok: true,
        scope,
        deleted: Array.isArray(data) ? data.length : 0,
      })
    }

    // Soft-delete for the RECIPIENT (user_id)
    const { data, error } = await admin
      .from('notifications')
      .update({ deleted_for_user_at: now })
      .in('id', ids)
      .eq('user_id', auth.user.id)
      .select('id')

    if (error) return json(500, { ok: false, error: 'UPDATE_FAILED', details: error.message })

    return json(200, {
      ok: true,
      scope,
      deleted: Array.isArray(data) ? data.length : 0,
    })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
