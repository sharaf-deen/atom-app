export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { canAccessExternalIncome, normalizeRole, type Role } from '@/lib/rbac'

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function GET(req: Request, ctx: { params: { id: string } }) {
  try {
    const entryId = ctx?.params?.id
    if (!entryId) return json(400, { ok: false, error: 'MISSING_ENTRY_ID' })

    const supa = createSupabaseServerActionClient()
    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) return json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const admin = makeAdminClient()
    if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_MISSING' })

    const { data: me } = await supa.from('profiles').select('role').eq('user_id', auth.user.id).maybeSingle<{ role: Role | null }>()
    const role = normalizeRole(me?.role)
    if (!canAccessExternalIncome(role)) return json(403, { ok: false, error: 'FORBIDDEN' })

    const { data: entry, error: entryErr } = await admin
      .from('external_income_entries')
      .select('id,attachment_path,attachment_filename,attachment_mime')
      .eq('id', entryId)
      .maybeSingle<{ id: string; attachment_path: string | null; attachment_filename: string | null; attachment_mime: string | null }>()

    if (entryErr) return json(404, { ok: false, error: 'ENTRY_NOT_FOUND', details: entryErr.message })
    if (!entry) return json(404, { ok: false, error: 'ENTRY_NOT_FOUND' })
    if (!entry.attachment_path) return json(404, { ok: false, error: 'ATTACHMENT_NOT_FOUND' })

    const filename = entry.attachment_filename || 'attachment'
    const wantDownload = new URL(req.url).searchParams.get('download') === '1'

    const dl = await admin.storage.from('external-income-attachments').download(entry.attachment_path)
    if (dl.error || !dl.data) return json(404, { ok: false, error: 'ATTACHMENT_NOT_FOUND', details: dl.error?.message })

    const ab = await dl.data.arrayBuffer()
    const mime = entry.attachment_mime || (dl.data as any)?.type || 'application/octet-stream'
    const disposition = wantDownload ? 'attachment' : 'inline'

    return new NextResponse(ab, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Disposition': `${disposition}; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
