import QRCode from 'qrcode'

export type MemberInviteEmailArgs = {
  to: string
  actionLink: string
  qrValue: string
  firstName?: string | null
  lastName?: string | null
  memberId?: string | null
  mode: 'invite' | 'resend'
}

export type MemberInviteEmailResult = {
  sent: boolean
  contains_qr: boolean
  provider: 'resend' | 'none'
  reason?: string
  email_id?: string | null
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function fullName(firstName?: string | null, lastName?: string | null) {
  const name = [firstName ?? '', lastName ?? ''].join(' ').trim()
  return name || 'Member'
}

function mailFrom() {
  return process.env.MAIL_FROM || 'noreply@example.com'
}

async function makeQrPngBase64(qrValue: string) {
  const dataUrl = await QRCode.toDataURL(qrValue, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 320,
  })

  return dataUrl.replace(/^data:image\/png;base64,/, '')
}

function subjectFor(mode: 'invite' | 'resend') {
  return mode === 'invite'
    ? 'Your ATOM invite + QR code'
    : 'Your ATOM invite link + QR code'
}

function makeText(args: MemberInviteEmailArgs) {
  const name = fullName(args.firstName, args.lastName)
  const memberLine = args.memberId ? `Member ID: ${args.memberId}\n` : ''

  return [
    `Hello ${name},`,
    '',
    modeTextLead(args.mode),
    memberLine.trimEnd(),
    '',
    'Activate your account here:',
    args.actionLink,
    '',
    'Your QR code is attached to this email as a PNG file.',
    `QR value: ${args.qrValue}`,
    '',
    'After activation, keep your QR code ready for check-in at ATOM.',
  ]
    .filter(Boolean)
    .join('\n')
}

function modeTextLead(mode: 'invite' | 'resend') {
  return mode === 'invite'
    ? 'Your ATOM account has been created. Use the button below to activate your account and set your password.'
    : 'Here is your new ATOM access link. Use the button below to activate your account and set your password.'
}

function makeHtml(args: MemberInviteEmailArgs, qrPngBase64: string) {
  const name = escapeHtml(fullName(args.firstName, args.lastName))
  const actionLink = escapeHtml(args.actionLink)
  const qrValue = escapeHtml(args.qrValue)
  const memberId = args.memberId ? escapeHtml(args.memberId) : ''
  const modeLead = escapeHtml(modeTextLead(args.mode))

  return `
  <div style="background:#f6f6f6;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#111;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e5e5;border-radius:18px;overflow:hidden;">
      <div style="padding:24px 24px 12px 24px;">
        <h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.2;">ATOM Jiu-Jitsu</h1>
        <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;">Hello ${name},</p>
        <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">${modeLead}</p>
        ${memberId ? `<p style="margin:0 0 16px 0;font-size:14px;line-height:1.5;"><strong>Member ID:</strong> ${memberId}</p>` : ''}
        <p style="margin:0 0 20px 0;">
          <a href="${actionLink}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 18px;border-radius:12px;font-size:14px;font-weight:700;">Activate account</a>
        </p>
      </div>

      <div style="padding:0 24px 24px 24px;">
        <div style="border:1px solid #e5e5e5;border-radius:16px;padding:16px;background:#fafafa;text-align:center;">
          <p style="margin:0 0 10px 0;font-size:13px;line-height:1.5;color:#555;">Your ATOM access QR code</p>
          <img
            src="data:image/png;base64,${qrPngBase64}"
            alt="ATOM member QR code"
            width="180"
            height="180"
            style="display:block;margin:0 auto 10px auto;background:#fff;border-radius:8px;"
          />
          <p style="margin:0;font-size:12px;line-height:1.5;color:#555;word-break:break-word;">${qrValue}</p>
        </div>

        <p style="margin:16px 0 0 0;font-size:13px;line-height:1.6;color:#555;">
          If the QR image does not display in your email app, use the attached PNG file.
        </p>
      </div>
    </div>
  </div>`
}

export async function sendMemberInviteEmailWithQr(args: MemberInviteEmailArgs): Promise<MemberInviteEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return {
      sent: false,
      contains_qr: false,
      provider: 'none',
      reason: 'RESEND_API_KEY_MISSING',
    }
  }

  if (!args.actionLink) {
    return {
      sent: false,
      contains_qr: false,
      provider: 'resend',
      reason: 'ACTION_LINK_MISSING',
    }
  }

  const qrPngBase64 = await makeQrPngBase64(args.qrValue)
  const fileStem = args.memberId?.trim() || 'atom-member'

  const payload = {
    from: mailFrom(),
    to: args.to,
    subject: subjectFor(args.mode),
    html: makeHtml(args, qrPngBase64),
    text: makeText(args),
    attachments: [
      {
        filename: `${fileStem}-qr.png`,
        content: qrPngBase64,
      },
    ],
  }

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!r.ok) {
    const err = await r.text().catch(() => '')
    return {
      sent: false,
      contains_qr: false,
      provider: 'resend',
      reason: `HTTP_${r.status}: ${err}`,
    }
  }

  const data = await r.json().catch(() => ({} as any))
  return {
    sent: true,
    contains_qr: true,
    provider: 'resend',
    email_id: data?.id ?? null,
  }
}

export function extractActionLink(linkData: any) {
  return (
    linkData?.properties?.action_link ||
    linkData?.properties?.actionLink ||
    linkData?.action_link ||
    linkData?.actionLink ||
    ''
  )
}
