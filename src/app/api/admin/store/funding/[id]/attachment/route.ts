export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { canAccessStoreFunding, normalizeRole, type Role } from '@/lib/rbac'

const STORE_FUNDING_BUCKET = 'store-funding-attachments'

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const fundingId = String(params?.id || '').trim()
    if (!fundingId) return json(400, { ok: false, error: 'MISSING_FUNDING_ID' })

    const authClient = createSupabaseServerActionClient()
    const { data: auth, error: authErr } = await authClient.auth.getUser()
    if (authErr) return json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const { data: me, error: meErr } = await authClient
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle<{ role: Role | null }>()

    if (meErr) return json(500, { ok: false, error: 'PROFILE_ERROR', details: meErr.message })
    const role = normalizeRole(me?.role)
    if (!canAccessStoreFunding(role)) return json(403, { ok: false, error: 'FORBIDDEN' })

    const admin = createSupabaseAdminClient()
    const { data: funding, error: fundingErr } = await admin
      .from('store_external_funding')
      .select('id,attachment_path,attachment_mime,attachment_filename')
      .eq('id', fundingId)
      .is('deleted_at', null)
      .maybeSingle<{
        id: string
        attachment_path: string | null
        attachment_mime: string | null
        attachment_filename: string | null
      }>()

    if (fundingErr) return json(404, { ok: false, error: 'FUNDING_NOT_FOUND', details: fundingErr.message })
    if (!funding) return json(404, { ok: false, error: 'FUNDING_NOT_FOUND' })
    if (!funding.attachment_path) return json(404, { ok: false, error: 'ATTACHMENT_NOT_FOUND' })

    const download = await admin.storage.from(STORE_FUNDING_BUCKET).download(funding.attachment_path)
    if (download.error || !download.data) {
      return json(404, { ok: false, error: 'ATTACHMENT_NOT_FOUND', details: download.error?.message })
    }

    const body = await download.data.arrayBuffer()
    const mime = funding.attachment_mime || (download.data as any)?.type || 'application/octet-stream'
    const filename = funding.attachment_filename || 'store-funding-attachment'

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) })
  }
}
