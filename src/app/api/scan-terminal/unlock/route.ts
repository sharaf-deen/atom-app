import { NextResponse } from 'next/server'
import { getSessionUserCached } from '@/lib/requestCache'
import { isScanTerminalRole } from '@/lib/rbac'

const UNLOCK_COOKIE = 'atom_scan_terminal_unlock'

function buildError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

export async function POST(request: Request) {
  const me = await getSessionUserCached()
  if (!me) return buildError('unauthorized', 401)
  if (!isScanTerminalRole(me.role)) return buildError('forbidden', 403)

  const configuredPin = String(process.env.SCAN_TERMINAL_EXIT_PIN || '').trim()
  if (!configuredPin) return buildError('Scan terminal exit PIN is not configured on the server.', 503)

  const body = await request.json().catch(() => ({}))
  const providedPin = String(body?.pin || '').trim()
  if (!providedPin) return buildError('Enter the admin PIN to exit terminal mode.', 400)
  if (providedPin !== configuredPin) return buildError('Invalid PIN.', 401)

  const response = NextResponse.json({ ok: true })
  response.cookies.set({
    name: UNLOCK_COOKIE,
    value: '1',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 3,
  })
  return response
}
