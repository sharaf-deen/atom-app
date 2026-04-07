export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

export async function POST() {
  return noStore(
    NextResponse.json(
      {
        ok: false,
        error: 'LEGACY_STORE_ORDER_CREATE_DISABLED',
        details:
          'Legacy cart/order creation is retired in Store V2. Use /store for preorders or /admin/store/sales for admin sales.',
      },
      { status: 410 }
    )
  )
}
