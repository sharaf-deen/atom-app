export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

type EditableStatus = 'draft' | 'ordered' | 'canceled'

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

export async function PATCH(req: NextRequest) {
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

    const body = await req.json().catch(() => ({} as any))
    const id = typeof body?.id === 'string' ? body.id.trim() : ''
    if (!id) return noStore(NextResponse.json({ ok: false, error: 'MISSING_ID' }, { status: 400 }))

    const { data: current, error: currentError } = await supa
      .from('store_supplier_orders')
      .select('id, status, ordered_at')
      .eq('id', id)
      .maybeSingle<{ id: string; status: string; ordered_at: string | null }>()

    if (currentError) {
      return noStore(NextResponse.json({ ok: false, error: 'LOOKUP_FAILED', details: currentError.message }, { status: 500 }))
    }
    if (!current) {
      return noStore(NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 }))
    }

    const patch: Record<string, any> = { updated_by: user.id }

    if (typeof body?.reference === 'string' || body?.reference === null) {
      patch.reference = typeof body.reference === 'string' ? body.reference.trim() || null : null
    }
    if (typeof body?.supplier_name === 'string') {
      const supplierName = body.supplier_name.trim()
      if (!supplierName) return noStore(NextResponse.json({ ok: false, error: 'SUPPLIER_REQUIRED' }, { status: 400 }))
      patch.supplier_name = supplierName
    }
    if (typeof body?.notes === 'string' || body?.notes === null) {
      patch.notes = typeof body.notes === 'string' ? body.notes.trim() || null : null
    }
    if (body?.expected_at === null || isDate(body?.expected_at)) {
      patch.expected_at = body.expected_at || null
    }

    if (body?.status !== undefined) {
      if (!isEditableStatus(body.status)) {
        return noStore(NextResponse.json({ ok: false, error: 'INVALID_STATUS' }, { status: 400 }))
      }
      if (current.status === 'partially_received' || current.status === 'received') {
        return noStore(NextResponse.json({ ok: false, error: 'STATUS_LOCKED_AFTER_RECEIPT' }, { status: 400 }))
      }
      patch.status = body.status
      if (body.status === 'ordered' && !current.ordered_at) patch.ordered_at = new Date().toISOString()
    }

    const { data, error } = await supa
      .from('store_supplier_orders')
      .update(patch)
      .eq('id', id)
      .select('id, status, reference, supplier_name, expected_at, notes')
      .maybeSingle()

    if (error) {
      return noStore(NextResponse.json({ ok: false, error: 'UPDATE_FAILED', details: error.message }, { status: 500 }))
    }

    try { revalidatePath('/admin/store') } catch {}
    try { revalidatePath('/store') } catch {}

    return noStore(NextResponse.json({ ok: true, item: data }))
  } catch (error: any) {
    return noStore(NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) }, { status: 500 }))
  }
}
