// src/app/api/expenses/[id]/receipt/route.ts
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
    const expenseId = ctx?.params?.id
    if (!expenseId) return json(400, { ok: false, error: 'MISSING_EXPENSE_ID' })

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
    const isStaff = ['admin', 'super_admin', 'reception'].includes(role)
    if (!isStaff) return json(403, { ok: false, error: 'FORBIDDEN' })

    // Fetch expense row with service role
    const { data: exp, error: expErr } = await admin
      .from('expenses')
      .select('id, receipt_path, receipt_filename, receipt_mime')
      .eq('id', expenseId)
      .maybeSingle<{ id: string; receipt_path: string | null; receipt_filename: string | null; receipt_mime: string | null }>()

    if (expErr) return json(404, { ok: false, error: 'EXPENSE_NOT_FOUND', details: expErr.message })
    if (!exp) return json(404, { ok: false, error: 'EXPENSE_NOT_FOUND' })
    if (!exp.receipt_path) return json(404, { ok: false, error: 'RECEIPT_NOT_FOUND' })

    const dl = await admin.storage.from('expense-receipts').download(exp.receipt_path)
    if (dl.error || !dl.data) {
      return json(404, { ok: false, error: 'RECEIPT_NOT_FOUND', details: dl.error?.message })
    }

    const ab = await dl.data.arrayBuffer()
    const mime = exp.receipt_mime || (dl.data as any)?.type || 'application/octet-stream'
    const filename = exp.receipt_filename || 'receipt'

    return new NextResponse(ab, {
      status: 200,
      headers: {
        'Content-Type': mime,
        // inline so images open in browser
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: any) {
    return json(500, { ok: false, error: 'SERVER_ERROR', details: e?.message ?? String(e) })
  }
}
