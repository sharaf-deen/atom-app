export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { canAccessStoreExpenses, normalizeRole, type Role } from '@/lib/rbac'

const STORE_EXPENSE_BUCKET = 'store-expense-attachments'

function json(status: number, body: any) {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const expenseId = String(params?.id || '').trim()
    if (!expenseId) return json(400, { ok: false, error: 'MISSING_EXPENSE_ID' })

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
    if (!canAccessStoreExpenses(role)) return json(403, { ok: false, error: 'FORBIDDEN' })

    const admin = createSupabaseAdminClient()
    const { data: expense, error: expenseErr } = await admin
      .from('store_expenses')
      .select('id,attachment_path,attachment_mime,attachment_filename')
      .eq('id', expenseId)
      .is('deleted_at', null)
      .maybeSingle<{
        id: string
        attachment_path: string | null
        attachment_mime: string | null
        attachment_filename: string | null
      }>()

    if (expenseErr) return json(404, { ok: false, error: 'EXPENSE_NOT_FOUND', details: expenseErr.message })
    if (!expense) return json(404, { ok: false, error: 'EXPENSE_NOT_FOUND' })
    if (!expense.attachment_path) return json(404, { ok: false, error: 'ATTACHMENT_NOT_FOUND' })

    const download = await admin.storage.from(STORE_EXPENSE_BUCKET).download(expense.attachment_path)
    if (download.error || !download.data) {
      return json(404, { ok: false, error: 'ATTACHMENT_NOT_FOUND', details: download.error?.message })
    }

    const body = await download.data.arrayBuffer()
    const mime = expense.attachment_mime || (download.data as any)?.type || 'application/octet-stream'
    const filename = expense.attachment_filename || 'store-expense-attachment'

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
