// src/app/api/kiosk/verify-exit-pin/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { getSessionUser, type Role } from '@/lib/session'

type Body = { pin?: string }

function canAccess(role: Role) {
  return role === 'reception' || role === 'admin' || role === 'super_admin'
}

function json(status: number, body: { ok: boolean; message?: string }) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
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
  const user = await getSessionUser()
  if (!user) return json(401, { ok: false, message: 'Unauthorized' })
  if (!canAccess(user.role)) return json(403, { ok: false, message: 'Forbidden' })

  if (user.role === 'super_admin') {
    return json(200, { ok: true })
  }

  let body: Body = {}
  try {
    body = (await req.json()) as Body
  } catch {
    body = {}
  }

  const pin = String(body.pin ?? '').trim()
  if (!pin) return json(400, { ok: false, message: 'Missing PIN' })

  const expected = String(process.env.KIOSK_EXIT_PIN ?? '').trim()
  if (!expected) {
    return json(500, { ok: false, message: 'Kiosk PIN not configured' })
  }

  if (!timingSafeEqual(pin, expected)) {
    return json(401, { ok: false, message: 'Invalid PIN' })
  }

  return json(200, { ok: true })
}
