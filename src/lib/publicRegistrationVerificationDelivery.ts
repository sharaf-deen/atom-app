import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { issueRegistrationEmailVerification } from '@/lib/publicRegistrationEmailVerification'

function safeAppOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (!configured) throw new Error('REGISTRATION_APP_ORIGIN_NOT_CONFIGURED')
  const url = new URL(configured)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('REGISTRATION_APP_ORIGIN_INVALID')
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('REGISTRATION_APP_HTTPS_REQUIRED')
  }
  return url.origin
}

export async function deliverRegistrationEmailVerification(requestId: string): Promise<'sent' | 'not_eligible'> {
  const apiKey = process.env.RESEND_API_KEY
  const sender = process.env.MAIL_FROM
  if (!apiKey || !sender) throw new Error('REGISTRATION_EMAIL_PROVIDER_NOT_CONFIGURED')
  const origin = safeAppOrigin()
  const admin = createSupabaseAdminClient()
  // The token is issued only after an authenticated staff action; the raw value
  // never reaches the requester or any database row.
  const issued = await issueRegistrationEmailVerification(admin, requestId)
  if (!issued) return 'not_eligible'

  // Fragment prevents automatic token transmission via the initial GET request.
  const link = `${origin}/registration/verify#token=${encodeURIComponent(issued.token)}`
  const body = {
    from: sender,
    to: [issued.email],
    subject: 'Verify your email — ATOM Jiu-Jitsu registration',
    text: `Hello,\n\nPlease verify the email address for your ATOM registration request by opening this link:\n${link}\n\nThis link expires in 30 minutes and can only be used once. If you did not request registration, ignore this message.\n\nATOM Jiu-Jitsu Academy`,
    html: `<p>Hello,</p><p>To verify the email address used for your ATOM registration request, open the link below:</p><p><a href="${link}">Verify email</a></p><p>The link expires in 30 minutes and can only be used once.</p><p>If you did not request registration, you can ignore this email.</p><p>ATOM Jiu-Jitsu Academy</p>`,
  }
  let response: Response
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    })
  } catch {
    throw new Error('REGISTRATION_VERIFICATION_DELIVERY_FAILED')
  }
  if (!response.ok) throw new Error('REGISTRATION_VERIFICATION_DELIVERY_FAILED')
  return 'sent'
}
