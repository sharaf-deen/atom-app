export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'

function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return res
}

export async function GET() {
  try {
    const supa = createSupabaseServerActionClient()
    const { data: authData, error: authError } = await supa.auth.getUser()

    if (authError || !authData.user) {
      return noStore(NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 }))
    }

    const admin = createSupabaseAdminClient()
    const { data, error } = await admin
      .from('legal_document_versions')
      .select('id,document_key,title,version_label,published_url,status,is_required,effective_from')
      .in('status', ['active', 'draft'])
      .order('document_key', { ascending: true })

    if (error) {
      return noStore(
        NextResponse.json(
          { ok: false, error: 'LEGAL_DOCUMENT_LOOKUP_FAILED', details: error.message },
          { status: 500 },
        ),
      )
    }

    const rank: Record<string, number> = {
      privacy_policy: 10,
      terms_of_use: 20,
      liability_waiver: 30,
    }

    const documents = (data ?? [])
      .sort((a: any, b: any) => (rank[a.document_key] ?? 99) - (rank[b.document_key] ?? 99))
      .map((row: any) => ({
        id: row.id,
        key: row.document_key,
        title: row.title,
        version: row.version_label,
        url: row.published_url,
        status: row.status,
        required: row.status === 'active' && row.is_required === true,
        effective_from: row.effective_from,
      }))

    return noStore(NextResponse.json({ ok: true, documents }))
  } catch (error: any) {
    return noStore(
      NextResponse.json(
        { ok: false, error: 'SERVER_ERROR', details: error?.message || String(error) },
        { status: 500 },
      ),
    )
  }
}
