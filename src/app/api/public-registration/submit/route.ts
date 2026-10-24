import { createHmac } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { RegistrationInputError, validatePendingRegistrationRequest } from '@/lib/publicRegistrationRequest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store' }
const generic = () => NextResponse.json({ ok: true, message: 'If your request is eligible, ATOM Reception will review it and arrange email verification.' }, { status: 202, headers: noStore })

export async function POST(request: NextRequest) {
  if (process.env.ATOM_PUBLIC_REGISTRATION_SUBMIT_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Registration is not available yet.' }, { status: 503, headers: noStore })
  }
  // In production, require a trusted proxy that overwrites x-forwarded-for.
  const secret = process.env.ATOM_REGISTRATION_RATE_LIMIT_SECRET
  if (!secret || secret.length < 32) {
    return NextResponse.json({ error: 'Registration is temporarily unavailable.' }, { status: 503, headers: noStore })
  }
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 415, headers: noStore })
  }
  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > 12000) return NextResponse.json({ error: 'Request too large.' }, { status: 413, headers: noStore })
  try {
    const rawText = await request.text()
    if (rawText.length > 12000) return NextResponse.json({ error: 'Request too large.' }, { status: 413, headers: noStore })
    const raw: unknown = JSON.parse(rawText)
    // Prefer Vercel's trusted ip header; never trust user-submitted JSON fields.
    const ip = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    if (!ip || ip.length > 64 || /[^0-9a-fA-F:.]/.test(ip)) return NextResponse.json({ error: 'Registration is temporarily unavailable.' }, { status: 503, headers: noStore })
    const ipHash = createHmac('sha256', secret).update(ip).digest('hex')
    const admin = createSupabaseAdminClient()
    const input = await validatePendingRegistrationRequest(admin, raw)
    const { error } = await admin.rpc('atom_submit_public_registration_v1', {
      p_request_key: input.request_key,
      p_account_email: input.account_email,
      p_first_name: input.participant_first_name,
      p_last_name: input.participant_last_name,
      p_date_of_birth: input.participant_date_of_birth,
      p_program_key: input.selected_program_key,
      p_phone: input.participant_phone,
      p_guardian_name: input.guardian_full_name,
      p_guardian_email: input.guardian_email,
      p_guardian_relationship: input.guardian_relationship,
      p_is_minor: input.is_minor,
      p_doc_ids: input.claimed_document_version_ids,
      p_ip_hash: ipHash,
    })
    if (error) throw error
    // Uniform response prevents leaking account/request existence.
    return generic()
  } catch (err) {
    if (err instanceof RegistrationInputError) {
      return NextResponse.json({ error: 'Please check the provided details and required documents.' }, { status: 400, headers: noStore })
    }
    if (err instanceof SyntaxError) return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: noStore })
    console.error('PUBLIC_REGISTRATION_SUBMISSION_FAILED')
    return NextResponse.json({ error: 'Registration is temporarily unavailable.' }, { status: 503, headers: noStore })
  }
}
