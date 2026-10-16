// Functional 1C.2A — Legacy subscription mutation route retired.
// All real subscription operations must use the validated /api/subscriptions/* endpoints.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'

function retired() {
  const response = NextResponse.json(
    {
      ok: false,
      error: 'LEGACY_SUBSCRIPTION_ACTION_RETIRED',
      details: 'This legacy endpoint is disabled. Use the validated subscription create, renew, settle and freeze workflows.',
    },
    { status: 410 },
  )
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function GET() {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  return retired()
}

export async function POST() {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  return retired()
}
