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

function timingSafeEqual(a: string, b: string) {
  // tiny constant-time-ish compare for short strings
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
  if (!user) return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 })
  if (!canAccess(user.role)) return NextResponse.json({ ok: false, message: 'Forbidden' }, { status: 403 })

  // Super admin can always exit without PIN
  if (user.role === 'super_admin') {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  let body: Body = {}
  try {
    body = (await req.json()) as Body
  } catch {
    body = {}
  }

  const pin = String(body.pin ?? '').trim()
  if (!pin) return NextResponse.json({ ok: false, message: 'Missing PIN' }, { status: 400 })

  const expected = String(process.env.KIOSK_EXIT_PIN ?? '').trim()
  if (!expected) {
    // Misconfigured environment
    return NextResponse.json({ ok: false, message: 'Kiosk PIN not configured' }, { status: 500 })
  }

  if (!timingSafeEqual(pin, expected)) {
    return NextResponse.json({ ok: false, message: 'Invalid PIN' }, { status: 401 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
