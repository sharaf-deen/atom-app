// src/app/api/membership-refunds/proof/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

const BUCKET = 'membership-refund-proofs'

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient<any>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function cleanProofPath(value: string | null) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw

  const withoutBucket = raw.startsWith(`${BUCKET}/`) ? raw.slice(BUCKET.length + 1) : raw
  return withoutBucket.replace(/^\/+/, '').replace(/\.\./g, '')
}

export async function GET(req: Request) {
  try {
    const supabase = createSupabaseServerActionClient()
    const { data: auth, error: authErr } = await supabase.auth.getUser()
    if (authErr) return json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const actorId = auth.user.id
    const { data: me, error: meErr } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', actorId)
      .maybeSingle<{ role: string | null }>()

    if (meErr) return json(500, { ok: false, error: 'PROFILE_LOOKUP_FAILED', details: meErr.message })

    const role = me?.role ?? 'member'
    const canView = role === 'admin' || role === 'super_admin'
    if (!canView) return json(403, { ok: false, error: 'FORBIDDEN' })

    const url = new URL(req.url)
    const rawPath = cleanProofPath(url.searchParams.get('path'))
    if (!rawPath) return json(400, { ok: false, error: 'MISSING_PATH' })

    if (/^https?:\/\//i.test(rawPath)) {
      return NextResponse.redirect(rawPath)
    }

    const admin = makeAdminClient()
    if (!admin) {
      return json(500, {
        ok: false,
        error: 'SERVICE_ROLE_MISSING',
        details: 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the server.',
      })
    }

    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(rawPath, 60)
    if (error || !data?.signedUrl) {
      return json(404, { ok: false, error: 'PROOF_NOT_FOUND', details: error?.message ?? 'Unable to create signed URL.' })
    }

    return NextResponse.redirect(data.signedUrl)
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
