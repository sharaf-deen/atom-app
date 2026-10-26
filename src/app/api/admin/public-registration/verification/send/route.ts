export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { normalizeRole } from '@/lib/rbac'
import { deliverRegistrationEmailVerification } from '@/lib/publicRegistrationVerificationDelivery'

const ALLOWED = new Set(['reception', 'admin', 'super_admin', 'head_coach'])
function json(body: object, status: number) {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function POST(req: Request) {
  // Deliberately staff-only until public registration anti-abuse and queue
  // creation are implemented in subsequent lots.
  const supabase = createSupabaseServerActionClient()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError || !auth.user) return json({ ok: false, error: 'NOT_AUTHENTICATED' }, 401)
  const admin = createSupabaseAdminClient()
  const { data: staff, error: roleError } = await admin.from('profiles')
    .select('role').eq('user_id', auth.user.id).maybeSingle()
  if (roleError) return json({ ok: false, error: 'ROLE_LOOKUP_FAILED' }, 500)
  if (!ALLOWED.has(String(normalizeRole(staff?.role) || ''))) {
    return json({ ok: false, error: 'FORBIDDEN' }, 403)
  }
  const body = await req.json().catch(() => null)
  const requestId = typeof body?.request_id === 'string' ? body.request_id.trim() : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return json({ ok: false, error: 'INVALID_REQUEST_ID' }, 400)
  }
  try {
    const result = await deliverRegistrationEmailVerification(requestId)
    if (result === 'not_eligible') return json({ ok: false, error: 'NOT_ELIGIBLE_OR_COOLDOWN' }, 409)
    return json({ ok: true, status: 'sent' }, 200)
  } catch (error) {
    // Only emit allowlisted internal diagnostic codes. Never log request payloads,
    // email addresses, verification tokens, provider responses or credentials.
    const known = new Set([
      'REGISTRATION_EMAIL_PROVIDER_NOT_CONFIGURED',
      'REGISTRATION_APP_ORIGIN_NOT_CONFIGURED',
      'REGISTRATION_APP_ORIGIN_INVALID',
      'REGISTRATION_APP_HTTPS_REQUIRED',
      'REGISTRATION_VERIFICATION_ISSUE_FAILED',
      'REGISTRATION_VERIFICATION_SNAPSHOT_FAILED',
      'REGISTRATION_VERIFICATION_DELIVERY_FAILED',
    ])
    const code = error instanceof Error && known.has(error.message)
      ? error.message : 'REGISTRATION_VERIFICATION_UNEXPECTED_FAILURE'
    console.error('[registration-verification/send] failed', { code })
    return json({ ok: false, error: 'EMAIL_VERIFICATION_UNAVAILABLE' }, 503)
  }
}
