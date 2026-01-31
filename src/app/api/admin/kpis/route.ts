export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'

// Petit alias: /api/admin/kpis → /api/admin/stats/revenue?type=kpi
export async function GET(req: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const url = new URL(req.url)
  url.pathname = '/api/admin/stats/revenue'
  url.searchParams.set('type', 'kpi')
  return NextResponse.redirect(url)
}
