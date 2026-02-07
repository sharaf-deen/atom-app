// src/app/api/invoices/[id]/download/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

type Role = 'member' | 'assistant_coach' | 'coach' | 'reception' | 'admin' | 'super_admin'

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

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  try {
    const invoiceId = ctx?.params?.id
    if (!invoiceId) return json(400, { ok: false, error: 'MISSING_INVOICE_ID' })

    const supa = createSupabaseServerActionClient()
    const { data: auth, error: authErr } = await supa.auth.getUser()
    if (authErr) return json(401, { ok: false, error: 'AUTH_ERROR', details: authErr.message })
    if (!auth.user) return json(401, { ok: false, error: 'NOT_AUTHENTICATED' })

    const admin = makeAdminClient()
    if (!admin) return json(500, { ok: false, error: 'SERVICE_ROLE_MISSING' })

    // Who is requesting?
    const { data: me } = await supa
      .from('profiles')
      .select('role')
      .eq('user_id', auth.user.id)
      .maybeSingle<{ role: Role | null }>()

    const role: Role = (me?.role as Role) ?? 'member'
    const isStaff = ['reception', 'admin', 'super_admin'].includes(role)

    // Fetch invoice row with service role (then authorize manually)
    const { data: inv, error: invErr } = await admin
      .from('invoices')
      .select('id, member_id, invoice_number, pdf_path')
      .eq('id', invoiceId)
      .maybeSingle<{ id: string; member_id: string; invoice_number: string; pdf_path: string }>()

    if (invErr) return json(404, { ok: false, error: 'INVOICE_NOT_FOUND', details: invErr.message })
    if (!inv) return json(404, { ok: false, error: 'INVOICE_NOT_FOUND' })

    const allowed = isStaff || inv.member_id === auth.user.id
    if (!allowed) return json(403, { ok: false, error: 'FORBIDDEN' })

    // Download pdf from storage
    const dl = await admin.storage.from('invoices').download(inv.pdf_path)
    if (dl.error || !dl.data) {
      return json(404, { ok: false, error: 'PDF_NOT_FOUND', details: dl.error?.message })
    }

    const ab = await dl.data.arrayBuffer()
    const filename = `${inv.invoice_number || 'invoice'}.pdf`

    return new NextResponse(ab, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
