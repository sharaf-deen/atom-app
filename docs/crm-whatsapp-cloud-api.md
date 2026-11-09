# ATOM CRM — WhatsApp Cloud API (disabled until configured)

Meta credentials must be entered as **server-only Vercel environment variables** in the ATOM project, never in client-side NEXT_PUBLIC variables or GitHub.

- `WA_PHONE_NUMBER_ID`: WhatsApp Cloud API phone number ID (not the visible phone number).
- `WA_ACCESS_TOKEN`: long-lived Meta system-user token with WhatsApp messaging permissions.
- `WA_APP_SECRET`: Meta App Secret (used to verify X-Hub-Signature-256).
- `WA_VERIFY_TOKEN`: strong random token chosen by ATOM for webhook GET validation.
- `WA_GRAPH_API_VERSION`: explicit Meta Graph API version, e.g. `v23.0`, to be chosen based on the active Meta app support at activation.

Meta webhook callback:
`https://atom-app-one.vercel.app/api/webhooks/whatsapp`

Subscribe WhatsApp Business Account to `messages` webhook notifications in Meta.
Meta must have permission to call the public webhook URL, but ALL POST payloads are verified with HMAC before saving.

Staff inbox:
`https://atom-app-one.vercel.app/admin/prospects/whatsapp`

In this stage: inbound text (and placeholders for unsupported media), message statuses, unique prospect matching by phone, human-reviewed free-form replies within 23 hours, exact-message audit trail. No AI-generated replies, no automated sends, no bulk campaigns, no message templates outside the customer service window.

Limitations before activating:
1. Confirm that ATOM's current WhatsApp number is eligible to be registered with Cloud API and Meta Business Manager, including any coexistence/migration requirements.
2. Do not disconnect or migrate a working WhatsApp Business app number without a backup and explicit approval.
3. Confirm app live mode, WABA phone number, permissions, and verification.
4. Test verification handshake, signed inbound webhook, dedupe, CRM prospect match, one approved outbound reply, status webhook, access denied and closed 24-hour window.
5. Review operational cost and Meta opt-in/template policy before adding automated outbound follow-ups.
