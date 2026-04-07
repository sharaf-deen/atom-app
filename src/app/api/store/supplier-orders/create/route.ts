export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

type EditableStatus = 'draft' | 'ordered' | 'canceled'

type Body = {
  reference?: string | null
  supplier_name?: string | null
  status?: EditableStatus
  expected_at?: string | null
  notes?: string | null
  items?: Array<{
    product_id?: string
    ordered_qty?: number
    unit_cost_cents?: number
  }>
}

type ProductSnapshot = {
  id: string
  name: string | null
  category: 'kimono' | 'rashguard' | 'short' | 'belt' | null
  color: string | null
  size: string | null
}

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

function isDate(value: unknown) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isEditableStatus(value: unknown): value is EditableStatus {
  return value === 'draft' || value === 'ordered' || value === 'canceled'
}

export async function POST(req: Request) {
  try {
    const supa = createSupabaseServerActionClient()

    const { data: auth, error: authError } = await supa.auth.getUser()
    if (authError) {
      return noStore(NextResponse.json({ ok: false, error: 'AUTH_ERROR', details: authError.message }, { status: 401 }))
    }
    const user = auth.user
    if (!user) return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))

    const { data: me, error: meError } = await supa.from('profiles').select('role').eq('user_id', user.id).maybeSingle<{ role: string | null }>()
    if (meError) {
      return noStore(NextResponse.json({ ok: false, error: 'PROFILE_ERROR', details: meError.message }, { status: 500 }))
    }
    if (me?.role !== 'super_admin') {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    const body = (await req.json().catch(() => ({}))) as Body
    const supplierName = String(body?.supplier_name || '').trim()
    const reference = typeof body?.reference === 'string' ? body.reference.trim() || null : null
    const status: EditableStatus = isEditableStatus(body?.status) ? body.status : 'ordered'
    const expectedAt = isDate(body?.expected_at) ? body.expected_at : null
    const notes = typeof body?.notes === 'string' ? body.notes.trim() || null : null
    const rawItems = Array.isArray(body?.items) ? body.items : []

    if (!supplierName) {
      return noStore(NextResponse.json({ ok: false, error: 'SUPPLIER_REQUIRED' }, { status: 400 }))
    }

    const groupedItems = new Map<string, { ordered_qty: number; unit_cost_cents: number }>()
    for (const item of rawItems) {
      const productId = String(item?.product_id || '').trim()
      const orderedQty = Math.floor(Number(item?.ordered_qty || 0))
      const unitCostCents = Math.max(0, Math.floor(Number(item?.unit_cost_cents || 0)))
      if (!productId || orderedQty <= 0) continue
      const previous = groupedItems.get(productId)
      if (previous) {
        previous.ordered_qty += orderedQty
        previous.unit_cost_cents = unitCostCents
      } else {
        groupedItems.set(productId, { ordered_qty: orderedQty, unit_cost_cents: unitCostCents })
      }
    }

    if (groupedItems.size === 0) {
      return noStore(NextResponse.json({ ok: false, error: 'NO_VALID_ITEMS' }, { status: 400 }))
    }

    const productIds = Array.from(groupedItems.keys())
    const { data: products, error: productsError } = await supa
      .from('store_products')
      .select('id, name, category, color, size')
      .in('id', productIds)
    if (productsError) {
      return noStore(NextResponse.json({ ok: false, error: 'PRODUCTS_QUERY_FAILED', details: productsError.message }, { status: 500 }))
    }

    const productMap = new Map(((products ?? []) as ProductSnapshot[]).map((product) => [product.id, product]))
    if (productMap.size !== productIds.length) {
      return noStore(NextResponse.json({ ok: false, error: 'PRODUCT_NOT_FOUND' }, { status: 400 }))
    }

    const { data: orderRow, error: orderError } = await supa
      .from('store_supplier_orders')
      .insert({
        reference,
        supplier_name: supplierName,
        status,
        notes,
        expected_at: expectedAt,
        ordered_at: status === 'ordered' ? new Date().toISOString() : null,
        created_by: user.id,
        updated_by: user.id,
      })
      .select('id')
      .maybeSingle<{ id: string }>()

    if (orderError || !orderRow?.id) {
      return noStore(NextResponse.json({ ok: false, error: 'ORDER_CREATE_FAILED', details: orderError?.message || 'Insert failed' }, { status: 500 }))
    }

    const itemsPayload = productIds.map((productId) => {
      const snapshot = productMap.get(productId)!
      const line = groupedItems.get(productId)!
      return {
        supplier_order_id: orderRow.id,
        product_id: productId,
        product_name: snapshot.name || 'Product',
        product_category: snapshot.category,
        product_color: snapshot.color,
        product_size: snapshot.size,
        unit_cost_cents: line.unit_cost_cents,
        ordered_qty: line.ordered_qty,
        received_qty: 0,
        line_status: status === 'canceled' ? 'canceled' : 'ordered',
      }
    })

    const { error: itemsError } = await supa.from('store_supplier_order_items').insert(itemsPayload)
    if (itemsError) {
      await supa.from('store_supplier_orders').delete().eq('id', orderRow.id)
      return noStore(NextResponse.json({ ok: false, error: 'ITEMS_CREATE_FAILED', details: itemsError.message }, { status: 500 }))
    }

    try { revalidatePath('/admin/store') } catch {}
    try { revalidatePath('/store') } catch {}

    return noStore(NextResponse.json({ ok: true, id: orderRow.id }))
  } catch (error: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) }, { status: 500 }))
  }
}
