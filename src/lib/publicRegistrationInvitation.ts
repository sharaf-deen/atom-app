import 'server-only'
import { extractActionLink, sendFamilyParentInviteEmail, sendMemberInviteEmailWithQr } from '@/lib/memberInviteEmail'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function appOrigin() {
  const value = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (!value) throw new Error('APP_ORIGIN_MISSING')
  const parsed = new URL(value)
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash ||
      (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:')) throw new Error('APP_ORIGIN_INVALID')
  return parsed.origin
}

/** Exactly one dispatch attempt. Failed or ambiguous responses are never automatically retried. */
export async function dispatchProvisionedRegistrationInvitation(admin: any, requestId: string, claimId: string, actorId: string) {
  if (![requestId, claimId, actorId].every(v => UUID.test(v))) return { ok: false, code: 'INVALID_IDENTIFIERS' }
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) return { ok: false, code: 'EMAIL_PROVIDER_NOT_CONFIGURED' }
  const origin = appOrigin()
  const { data: reservation, error: reserveError } = await admin.rpc('atom_begin_registration_invitation_v1', {
    p_request_id: requestId, p_claim_id: claimId, p_actor_id: actorId,
  })
  if (reserveError) throw new Error('INVITATION_RESERVATION_UNAVAILABLE')
  const row = Array.isArray(reservation) ? reservation[0] : reservation
  if (!row?.ok) return { ok: false, code: String(row?.code || 'NOT_ELIGIBLE') }
  // The durable reservation is committed before any external call: ambiguous failures are review-only.
  const redirectTo = `${origin}/auth/complete-invite?next=${encodeURIComponent(row.is_minor ? '/family' : '/')}`
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'recovery', email: row.account_email, redirectTo,
  })
  if (linkError) return { ok: false, code: 'LINK_GENERATION_REQUIRES_REVIEW' }
  const actionLink = extractActionLink(linkData)
  if (!actionLink || linkData?.user?.id !== row.auth_user_id)
    return { ok: false, code: 'LINK_IDENTITY_REQUIRES_REVIEW' }

  let delivery: { sent: boolean; email_id?: string | null }
  try {
    if (row.is_minor) {
      delivery = await sendFamilyParentInviteEmail({ to: row.account_email, actionLink })
    } else {
      delivery = await sendMemberInviteEmailWithQr({
        to: row.account_email, actionLink, qrValue: `atom:${row.member_user_id}`, mode: 'invite',
      })
    }
  } catch {
    return { ok: false, code: 'DELIVERY_REQUIRES_REVIEW' }
  }
  if (!delivery.sent || !delivery.email_id) return { ok: false, code: 'DELIVERY_REQUIRES_REVIEW' }
  const { data: saved, error: saveError } = await admin.rpc('atom_record_registration_invitation_v1', {
    p_request_id: requestId, p_claim_id: claimId, p_actor_id: actorId, p_email_id: delivery.email_id,
  })
  if (saveError || saved !== true) return { ok: false, code: 'DELIVERED_RECORD_REQUIRES_REVIEW' }
  return { ok: true, code: 'INVITATION_SENT' }
}
