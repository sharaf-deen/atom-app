export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { getSessionUser, type Role } from '@/lib/session'
import { jsonWithApiRuntime, logApiError, startApiRuntime } from '@/lib/apiRuntime'

type Body = { pin?: string }

type VerifyBody = { ok: boolean; message?: string }

function canAccess(role: Role) {
  return role === 'reception' || role === 'admin' || role === 'super_admin'
}

function json(meta: ReturnType<typeof startApiRuntime>, status: number, body: VerifyBody) {
  return jsonWithApiRuntime(meta, status, body, 'no-store')
}

function timingSafeEqual(a: string, b: string) {
  const aa = new TextEncoder().encode(a)
  const bb = new TextEncoder().encode(b)
  const len = Math.max(aa.length, bb.length)
  let out = 0
  for (let i = 0; i < len; i++) {
    out |= (aa[i] ?? 0) ^ (bb[i] ?? 0)
  }
  return out === 0 && aa.length === bb.length
}

export async function POST(req: Request) {
  const meta = startApiRuntime('/api/kiosk/verify-exit-pin')
  const user = await getSessionUser()
  if (!user) return json(meta, 401, { ok: false, message: 'Unauthorized' })
  if (!canAccess(user.role)) return json(meta, 403, { ok: false, message: 'Forbidden' })

  if (user.role === 'super_admin') {
    return json(meta, 200, { ok: true })
  }

  let body: Body = {}
  try {
    body = (await req.json()) as Body
  } catch {
    body = {}
  }

  const pin = String(body.pin ?? '').trim()
  if (!pin) return json(meta, 400, { ok: false, message: 'Missing PIN' })
  if (pin.length > 32) return json(meta, 400, { ok: false, message: 'Invalid PIN' })

  const expected = String(process.env.KIOSK_EXIT_PIN ?? '').trim()
  if (!expected) {
    logApiError(meta, 'env', 'KIOSK_EXIT_PIN not configured')
    return json(meta, 500, { ok: false, message: 'Kiosk PIN not configured' })
  }

  if (!timingSafeEqual(pin, expected)) {
    return json(meta, 401, { ok: false, message: 'Invalid PIN' })
  }

  return json(meta, 200, { ok: true })
}
