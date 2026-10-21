export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { consumeRegistrationEmailVerification } from '@/lib/publicRegistrationEmailVerification'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  const response = (data: object, status: number) => {
    const res = NextResponse.json(data, { status })
    res.headers.set('Cache-Control', 'no-store')
    return res
  }
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return response({ ok: false, error: 'VERIFICATION_INVALID_OR_EXPIRED' }, 400)
  }
  try {
    const result = await consumeRegistrationEmailVerification(createSupabaseAdminClient(), token)
    if (!result.verified) return response({ ok: false, error: 'VERIFICATION_INVALID_OR_EXPIRED' }, 400)
    // A verified email does NOT authorize membership creation or family linking.
    return response({ ok: true, status: 'verified' }, 200)
  } catch {
    return response({ ok: false, error: 'VERIFICATION_UNAVAILABLE' }, 503)
  }
}
