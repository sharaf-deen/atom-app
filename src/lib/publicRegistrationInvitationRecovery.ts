import 'server-only'
import { extractActionLink, sendFamilyParentInviteEmail, sendMemberInviteEmailWithQr } from '@/lib/memberInviteEmail'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function appOrigin() {
  const value = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (!value) throw new Error('APP_ORIGIN_MISSING')
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
    (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) throw new Error('APP_ORIGIN_INVALID')
  return url.origin
}

/** Observational lookup only. Resend statuses are not proof that the recipient opened the message. */
export async function inspectRegistrationEmailDelivery(admin: any, requestId: string) {
  if (!UUID.test(requestId)) return { ok: false, code: 'INVALID_REQUEST_ID' }
  const { data: row, error } = await admin.from('atom_public_registration_requests')
    .select('invitation_dispatch_started_at,invitation_dispatched_at,invitation_email_id,password_setup_reported_at,status')
    .eq('id', requestId).maybeSingle()
  if (error) return { ok: false, code: 'LOOKUP_UNAVAILABLE' }
  if (!row) return { ok: false, code: 'NOT_FOUND' }
  if (!row.invitation_dispatch_started_at) return { ok: true, state: 'NOT_ATTEMPTED', resend_eligible: false }
  if (!row.invitation_dispatched_at || !row.invitation_email_id) return { ok: true, state: 'UNCERTAIN_REVIEW_REQUIRED', resend_eligible: false }
  const { data: attempts, error: attemptsError } = await admin.from('atom_registration_invitation_resend_attempts')
    .select('started_at,recorded_at,provider_email_id').eq('request_id',requestId).order('started_at',{ascending:false}).limit(4)
  if (attemptsError) return { ok: false, code: 'AUDIT_UNAVAILABLE' }
  const rows = attempts || []
  const uncertain = rows.some((a: any) => !a.recorded_at)
  const latest = rows[0]?.provider_email_id || row.invitation_email_id
  if (!process.env.RESEND_API_KEY) return { ok: false, code: 'PROVIDER_NOT_CONFIGURED' }
  try {
    const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(latest)}`, {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, cache: 'no-store', signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) return { ok: false, code: 'PROVIDER_STATUS_UNAVAILABLE' }
    const data = await response.json() as { last_event?: string; id?: string }
    if (data.id !== latest) return { ok: false, code: 'PROVIDER_ID_MISMATCH' }
    const event = typeof data.last_event === 'string' ? data.last_event : 'unknown'
    return { ok: true, state: uncertain ? 'UNCERTAIN_REVIEW_REQUIRED' : 'RECORDED',
      provider_status: ['sent','delivered','bounced','failed','delivery_delayed','complained','opened','clicked'].includes(event) ? event : 'unknown',
      resend_eligible: !uncertain && !row.password_setup_reported_at && row.status === 'invitation_pending' && rows.length < 3 }
  } catch { return { ok: false, code: 'PROVIDER_STATUS_UNAVAILABLE' } }
}

/** Super Admin request. Never retries an uncertain attempt or automatically links an identity. */
export async function resendRegistrationInvitation(admin: any, requestId: string, claimId: string, actorId: string, reason: string) {
  if (![requestId,claimId,actorId].every(v => UUID.test(v)) || reason.trim().length < 12 || reason.length > 1000)
    return { ok: false, code: 'INVALID_INPUT' }
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) return { ok: false, code: 'PROVIDER_NOT_CONFIGURED' }
  const origin = appOrigin()
  const { data: raw, error } = await admin.rpc('atom_begin_registration_invitation_resend_v1', {
    p_request_id: requestId, p_claim_id: claimId, p_actor_id: actorId, p_reason: reason,
  })
  if (error) return { ok: false, code: 'RESERVATION_UNAVAILABLE' }
  const row = Array.isArray(raw) ? raw[0] : raw
  if (!row?.ok) return { ok: false, code: row?.code || 'NOT_ELIGIBLE' }
  // Reservation is durable. From here, any error requires manual inspection, never a blind resend.
  const redirectTo = `${origin}/auth/complete-invite?next=${encodeURIComponent(row.is_minor ? '/family' : '/')}`
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'recovery',email: row.account_email,redirectTo,
  })
  if (linkError || linkData?.user?.id !== row.auth_user_id) return { ok: false, code: 'LINK_REVIEW_REQUIRED' }
  const actionLink = extractActionLink(linkData)
  if (!actionLink) return { ok: false, code: 'LINK_REVIEW_REQUIRED' }
  try {
    const result = row.is_minor
      ? await sendFamilyParentInviteEmail({to:row.account_email,actionLink})
      : await sendMemberInviteEmailWithQr({to:row.account_email,actionLink,qrValue:`atom:${row.member_user_id}`,mode:'resend'})
    if (!result.sent || !result.email_id) return { ok: false, code: 'DELIVERY_REVIEW_REQUIRED' }
    const { data: recorded, error: recordError } = await admin.rpc('atom_record_registration_invitation_resend_v1', {
      p_attempt_id: row.attempt_id,p_request_id:requestId,p_claim_id:claimId,p_actor_id:actorId,p_provider_email_id:result.email_id,
    })
    if (recordError || recorded !== true) return { ok: false, code: 'RECEIPT_REVIEW_REQUIRED' }
    return { ok: true, code: 'RESEND_RECORDED' }
  } catch { return { ok: false, code: 'DELIVERY_REVIEW_REQUIRED' } }
}
