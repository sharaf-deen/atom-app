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
  return name || ''
}

function greetingLabel(args: MemberInviteEmailArgs) {
  const name = fullName(args.firstName, args.lastName)
  return name || args.to || 'Member'
}

function mailFrom() {
  return process.env.MAIL_FROM || 'noreply@example.com'
}

async function makeQrPngBase64(qrValue: string) {
  const dataUrl = await QRCode.toDataURL(qrValue, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 360,
  })

  return dataUrl.replace(/^data:image\/png;base64,/, '')
}

function subjectFor(mode: 'invite' | 'resend') {
  return mode === 'invite'
    ? 'Activate your Atom Jiu-Jitsu HQ account'
    : 'Your new Atom Jiu-Jitsu HQ activation link'
}

function modeTextLead(mode: 'invite' | 'resend') {
  return mode === 'invite'
    ? 'Your profile has been created by our team. To finish activating your account and access the app, please choose your password.'
    : 'A new activation link has been generated for your account. To finish activating your account and access the app, please choose your password.'
}

function makeText(args: MemberInviteEmailArgs) {
  const name = greetingLabel(args)
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
    'Your ATOM access QR code is included in this email and attached as a PNG file.',
    '',
    'If the QR image does not display in your email app, use the attached PNG file.',
    '',
    'For security reasons, this link will expire after a short time. If it expires, please contact the academy so we can send you a new one.',
    '',
    'If you did not expect this email, you can safely ignore it.',
    '',
    'Oss,',
    'Atom Jiu-Jitsu Academy since 2021',
  ]
    .filter(Boolean)
    .join('\n')
}

function makeHtml(args: MemberInviteEmailArgs) {
  const greeting = escapeHtml(greetingLabel(args))
  const actionLink = escapeHtml(args.actionLink)
  const modeLead = escapeHtml(modeTextLead(args.mode))

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f4f4f5;padding:24px 0;">
      <tr>
        <td align="center">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:480px;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4e4e7;">

            <!-- LOGO EN HAUT CLIQUABLE -->
            <tr>
              <td style="padding:20px 24px 8px 24px;text-align:center;background-color:#000000;">
                <a
                  href="https://atom-app-one.vercel.app/"
                  target="_blank"
                  style="text-decoration:none;display:inline-block;"
                >
                  <img
                    src="https://atomjiujitsuhq.com/wp-content/uploads/2025/11/LogoAtomNew180px.png"
                    alt="Atom Jiu-Jitsu HQ"
                    style="
                      display:block;
                      margin:0 auto;
                      width:140px;
                      max-width:60%;
                      height:auto;
                    "
                  />
                </a>
              </td>
            </tr>

            <!-- TITRE / INTRO -->
            <tr>
              <td style="padding:16px 24px 4px 24px;text-align:left;">
                <p style="margin:0 0 4px 0;font-size:14px;color:#71717a;">
                  Hi ${greeting},
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:0 24px 12px 24px;text-align:left;">
                <p style="margin:0;font-size:14px;color:#18181b;line-height:1.5;">
                  Welcome to <strong>Atom Jiu-Jitsu HQ</strong>!<br/>
                  ${modeLead}
                </p>
              </td>
            </tr>

            <!-- BOUTON -->
            <tr>
              <td style="padding:16px 24px 8px 24px;text-align:center;">
                <a
                  href="${actionLink}"
                  style="
                    display:inline-block;
                    padding:12px 24px;
                    background-color:#000000;
                    color:#ffffff;
                    text-decoration:none;
                    border-radius:999px;
                    font-size:14px;
                    font-weight:600;
                  "
                >
                  Set your password
                </a>
              </td>
            </tr>

            <!-- QR CODE -->
            <tr>
              <td style="padding:8px 24px 8px 24px;text-align:center;">
                <table
                  width="100%"
                  cellpadding="0"
                  cellspacing="0"
                  role="presentation"
                  style="border:1px solid #e4e4e7;border-radius:16px;background-color:#fafafa;"
                >
                  <tr>
                    <td style="padding:16px 16px 8px 16px;text-align:center;">
                      <p style="margin:0;font-size:13px;color:#71717a;">
                        Your ATOM access QR code
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 16px 8px 16px;text-align:center;">
                      <img
                        src="cid:member-qr"
                        alt="ATOM member QR code"
                        width="180"
                        height="180"
                        style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;width:180px;height:180px;max-width:100%;background:#ffffff;"
                      />
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 16px 16px 16px;text-align:center;">
                      <p style="margin:0;font-size:12px;color:#a1a1aa;line-height:1.5;">
                        If the QR image does not display in your email app, use the attached PNG file.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- TEXTE DE SÉCURITÉ -->
            <tr>
              <td style="padding:8px 24px 12px 24px;text-align:left;">
                <p style="margin:0;font-size:12px;color:#71717a;line-height:1.5;">
                  For security reasons, this link will expire after a short time. If it expires, please contact the academy so we can send you a new one.
                </p>
              </td>
            </tr>

            <!-- FOOTER EMAIL -->
            <tr>
              <td style="padding:4px 24px 20px 24px;text-align:left;">
                <p style="margin:0;font-size:12px;color:#71717a;line-height:1.5;">
                  If you did not expect this email, you can safely ignore it.
                </p>
                <p style="margin:8px 0 0 0;font-size:12px;color:#a1a1aa;">
                  Oss,<br/>
                  Atom Jiu-Jitsu Academy since 2021
                </p>
              </td>
            </tr>
          </table>

          <p style="margin-top:12px;font-size:11px;color:#a1a1aa;">
            You received this email because an account was created for you at Atom Jiu-Jitsu HQ.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`
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
    to: [args.to],
    subject: subjectFor(args.mode),
    html: makeHtml(args),
    text: makeText(args),
    attachments: [
      {
        filename: `${fileStem}-qr-inline.png`,
        content: qrPngBase64,
        content_type: 'image/png',
        content_id: 'member-qr',
      },
      {
        filename: `${fileStem}-qr.png`,
        content: qrPngBase64,
        content_type: 'image/png',
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