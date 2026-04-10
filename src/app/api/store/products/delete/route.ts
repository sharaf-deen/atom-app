// src/app/api/store/products/delete/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

const IMAGE_BUCKET = 'store-product-images'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

async function removeImageIfAny(admin: ReturnType<typeof createSupabaseAdminClient>, path?: string | null) {
  const safe = String(path || '').trim()
  if (!safe) return
  try {
    await admin.storage.from(IMAGE_BUCKET).remove([safe])
  } catch {
    // best effort cleanup
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supa = createSupabaseServerActionClient()
    const admin = createSupabaseAdminClient()

    // 1) Auth
    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'AUTH_ERROR', details: authErr.message }, { status: 401 })
      )
    }
    const user = auth.user
    if (!user) {
      return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))
    }

    // 2) Role check
    const { data: me, error: meErr } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle<{ role: string | null }>()
    if (meErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'PROFILE_ERROR', details: meErr.message }, { status: 500 })
      )
    }
    if (me?.role !== 'super_admin') {
      return noStore(NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 }))
    }

    // 3) Param
    const url = new URL(req.url)
    const id = (url.searchParams.get('id') || '').trim()
    if (!id) return noStore(NextResponse.json({ ok: false, error: 'MISSING_ID' }, { status: 400 }))

    const { data: existing, error: existingErr } = await admin
      .from('store_products')
      .select('id, image_path')
      .eq('id', id)
      .maybeSingle<{ id: string; image_path: string | null }>()

    if (existingErr) {
      return noStore(
        NextResponse.json({ ok: false, error: 'READ_FAILED', details: existingErr.message }, { status: 500 })
      )
    }
    if (!existing) {
      return noStore(NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 }))
    }

    // 4) Delete
    const { error } = await admin.from('store_products').delete().eq('id', id)
    if (error) {
      return noStore(
        NextResponse.json({ ok: false, error: 'DELETE_FAILED', details: error.message }, { status: 500 })
      )
    }

    await removeImageIfAny(admin, existing.image_path)

    return noStore(NextResponse.json({ ok: true }))
  } catch (e: any) {
    return noStore(
      NextResponse.json({ ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) }, { status: 500 })
    )
  }
}
