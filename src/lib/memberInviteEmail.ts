import QRCode from 'qrcode'

export type InviteEmailMode = 'custom_qr' | 'supabase_default' | 'none'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function personLabel(firstName?: string | null, lastName?: string | null) {
  const full = [firstName, lastName].filter(Boolean).join(' ').trim()
  return full || 'Member'
}

function qrFilename(memberId?: string | null) {
  const suffix = (memberId || 'member').replace(/[^a-zA-Z0-9_-]/g, '-')
  return `atom-qr-${suffix}.png`
}

export async function sendMemberInviteEmailWithQr(args: {
  to: string
  inviteLink: string
  qrValue: string
  memberId?: string | null
  firstName?: string | null
  lastName?: string | null
  appUrl?: string | null
}) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.MAIL_FROM || 'noreply@example.com'

  if (!apiKey) return { sent: false as const, reason: 'RESEND_API_KEY_MISSING' }

  const { to, inviteLink, qrValue, memberId, firstName, lastName, appUrl } = args

  const qrDataUrl = await QRCode.toDataURL(qrValue, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 256,
  })

  const qrBase64 = qrDataUrl.split(',')[1] || ''
  const safeName = escapeHtml(personLabel(firstName, lastName))
  const safeInviteLink = escapeHtml(inviteLink)
  const safeQrValue = escapeHtml(qrValue)
  const safeMemberId = escapeHtml(memberId || 'Pending assignment')
  const safeAppUrl = escapeHtml((appUrl || '').replace(/\/$/, ''))

  const subject = 'Your ATOM App invite + access QR code'

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#111;max-width:640px;margin:0 auto;padding:24px;">
    <h2 style="margin:0 0 12px;">Welcome to ATOM</h2>
    <p style="margin:0 0 12px;">Hello ${safeName},</p>
    <p style="margin:0 0 12px;">Your member account has been created. Use the button below to activate your account and set your password.</p>

    <p style="margin:20px 0;">
      <a href="${safeInviteLink}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:600;">
        Activate account
      </a>
    </p>

    <div style="margin:24px 0;padding:16px;border:1px solid #e5e7eb;border-radius:16px;background:#fafafa;text-align:center;">
      <div style="font-size:13px;color:#666;margin-bottom:8px;">Your access QR code</div>
      <img src="${qrDataUrl}" alt="Member QR code" width="180" height="180" style="display:block;margin:0 auto 12px;background:#fff;padding:10px;border-radius:12px;border:1px solid #e5e7eb;" />
      <div style="font-size:13px;color:#333;margin-bottom:4px;">Member ID: <strong>${safeMemberId}</strong></div>
      <div style="font-size:12px;color:#666;word-break:break-all;">QR value: ${safeQrValue}</div>
      <div style="font-size:12px;color:#666;margin-top:8px;">A PNG copy of this QR code is also attached to this email.</div>
    </div>

    <p style="margin:0 0 8px;">After activating your account, you can also find the QR code inside your profile in the app.</p>
    ${safeAppUrl ? `<p style="margin:0;color:#666;font-size:12px;">App: ${safeAppUrl}</p>` : ''}
  </div>
  `

  const text = [
    `Hello ${personLabel(firstName, lastName)},`,
    '',
    'Your ATOM member account has been created.',
    'Activate your account and set your password here:',
    inviteLink,
    '',
    `Member ID: ${memberId || 'Pending assignment'}`,
    `QR value: ${qrValue}`,
    '',
    'A PNG copy of your QR code is attached to this email.',
  ].join('\n')

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      text,
      attachments: [
        {
          filename: qrFilename(memberId),
          content: qrBase64,
        },
      ],
    }),
  })

  if (!r.ok) {
    const err = await r.text().catch(() => '')
    return { sent: false as const, reason: `HTTP_${r.status}: ${err}` }
  }

  return { sent: true as const }
}
