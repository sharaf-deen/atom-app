export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

type Body = {
  sale_id?: string
}

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function cleanText(value: unknown) {
  return String(value || '').trim()
}

async function requireSuperAdmin() {
  const authClient = createSupabaseServerActionClient()
  const admin = createSupabaseAdminClient()

  const { data: auth, error: authErr } = await authClient.auth.getUser()
  if (authErr) {
    return { ok: false as const, response: noStore(NextResponse.json({ ok: false, error: 'AUTH_ERROR', details: authErr.message }, { status: 401 })) }
  }
  const user = auth.user
  if (!user) {
    return { ok: false as const, response: noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 })) }
  }

  const { data: me, error: meErr } = await authClient
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle<{ role: string | null }>()

  if (meErr) {
    return { ok: false as const, response: noStore(NextResponse.json({ ok: false, error: 'PROFILE_ERROR', details: meErr.message }, { status: 500 })) }
  }
  if (me?.role !== 'super_admin') {
    return { ok: false as const, response: noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 })) }
  }

  return { ok: true as const, admin }
}

export async function POST(req: Request) {
  try {
    const guard = await requireSuperAdmin()
    if (!guard.ok) return guard.response

    const admin = guard.admin
    const body = (await req.json().catch(() => ({}))) as Body
    const saleId = cleanText(body.sale_id)
    if (!saleId) {
      return noStore(NextResponse.json({ ok: false, error: 'MISSING_SALE_ID' }, { status: 400 }))
    }

    const { data: sale, error: saleErr } = await admin
      .from('store_sales')
      .select('id,status')
      .eq('id', saleId)
      .maybeSingle<{ id: string; status: string | null }>()

    if (saleErr) {
      return noStore(NextResponse.json({ ok: false, error: 'SALE_LOOKUP_FAILED', details: saleErr.message }, { status: 500 }))
    }
    if (!sale) {
      return noStore(NextResponse.json({ ok: false, error: 'SALE_NOT_FOUND' }, { status: 404 }))
    }

    const { data: items, error: itemsErr } = await admin
      .from('store_sale_items')
      .select('sale_id,delivered_stock_applied')
      .eq('sale_id', saleId)

    if (itemsErr) {
      return noStore(NextResponse.json({ ok: false, error: 'SALE_ITEMS_LOOKUP_FAILED', details: itemsErr.message }, { status: 500 }))
    }

    const hasAppliedStock = (Array.isArray(items) ? items : []).some((item: any) => !!item?.delivered_stock_applied)
    if (hasAppliedStock) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'STOCK_ALREADY_APPLIED', details: 'Delete is blocked because stock was already applied on this sale.' },
          { status: 400 }
        )
      )
    }

    const { error: itemDeleteErr } = await admin.from('store_sale_items').delete().eq('sale_id', saleId)
    if (itemDeleteErr) {
      return noStore(NextResponse.json({ ok: false, error: 'SALE_ITEMS_DELETE_FAILED', details: itemDeleteErr.message }, { status: 500 }))
    }

    const { error: saleDeleteErr } = await admin.from('store_sales').delete().eq('id', saleId)
    if (saleDeleteErr) {
      return noStore(NextResponse.json({ ok: false, error: 'SALE_DELETE_FAILED', details: saleDeleteErr.message }, { status: 500 }))
    }

    try {
      revalidatePath('/admin/store')
      revalidatePath('/admin/store/sales')
      revalidatePath('/admin/store/dashboard')
    } catch {}

    return noStore(NextResponse.json({ ok: true, id: saleId }))
  } catch (e: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message || String(e) }, { status: 500 }))
  }
}
