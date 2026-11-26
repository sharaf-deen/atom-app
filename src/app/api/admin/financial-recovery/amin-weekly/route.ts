import { randomUUID } from 'node:crypto'
import { revalidatePath, revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { generateInvoicePdfBytes, type InvoiceSnapshot } from '@/lib/invoices'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { createSupabaseServerActionClient } from '@/lib/supabaseServer'

export const runtime = 'nodejs'

const memberId = '7f76286a-56f9-49ae-9859-90851c5df79d'
const invoiceNumber = 'INV-CORR-20261126-000607'

function reply(status: number, data: object) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  try {
    const session = createSupabaseServerActionClient()
    const { data: auth, error: authError } = await session.auth.getUser()
    if (authError || !auth.user) return reply(401, { error: 'Sign in as Super Admin.' })

    const { data: actor } = await session.from('profiles')
      .select('role').eq('user_id', auth.user.id).maybeSingle()
    if (actor?.role !== 'super_admin') return reply(403, { error: 'Super Admin required.' })

    const body = await request.json().catch(() => null)
    if (body?.operation !== 'preview' && body?.operation !== 'apply') {
      return reply(400, { error: 'Invalid operation.' })
    }

    const admin = createSupabaseAdminClient()
    const args = { p_actor: auth.user.id, p_issued_at: new Date().toISOString() }
    const { data: preview, error: previewError } = await admin.rpc('atom_correct_amin_weekly', args)
    if (previewError) return reply(409, { error: previewError.message })
    if (preview?.applied) return reply(200, { applied: true, invoiceNumber })
    if (!preview?.snapshot) return reply(500, { error: 'Correction preview could not be verified.' })
    if (body.operation === 'preview') return reply(200, { ready: true })

    const snapshot = preview.snapshot as InvoiceSnapshot
    const bytes = await generateInvoicePdfBytes(snapshot)
    const path = `${memberId}/${invoiceNumber}-${randomUUID()}.pdf`
    const storage = admin.storage.from('invoices')
    const { error: uploadError } = await storage.upload(path, bytes, { contentType: 'application/pdf' })
    if (uploadError) return reply(500, { error: 'Corrective PDF could not be saved.' })

    const { data: result, error } = await admin.rpc('atom_correct_amin_weekly', { ...args, p_pdf_path: path })
    if (error) {
      if (error.code === 'P0001' || error.code === '42501') await storage.remove([path])
      return reply(409, { error: error.message })
    }
    if (!result?.applied) return reply(500, { error: 'Correction could not be verified.' })
    if (result.pdf_path !== path) await storage.remove([path])

    revalidatePath(`/members/${memberId}`)
    revalidatePath(`/members/${memberId}/subscriptions`)
    revalidatePath('/invoices')
    revalidateTag('invoices')
    return reply(200, { applied: true, invoiceNumber })
  } catch (error) {
    console.error('Amin weekly subscription correction failed', error)
    return reply(500, { error: 'Correction could not be completed. Run the preview to check its status.' })
  }
}
