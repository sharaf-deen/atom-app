import { createHmac, timingSafeEqual } from 'node:crypto'

export function configuredWhatsApp() {
  return Boolean(process.env.WA_PHONE_NUMBER_ID && process.env.WA_ACCESS_TOKEN &&
    process.env.WA_APP_SECRET && process.env.WA_VERIFY_TOKEN)
}
export function verifyWhatsAppSignature(raw: string, received: string|null, secret: string) {
  if (!received || !/^sha256=[a-f0-9]{64}$/i.test(received) || !secret) return false
  const expected = createHmac('sha256', secret).update(raw, 'utf8').digest()
  const supplied = Buffer.from(received.slice(7), 'hex')
  return expected.length === supplied.length && timingSafeEqual(expected, supplied)
}
export function waDigits(value: unknown): string {
  const digits=String(value??'').replace(/\D/g,'')
  return /^[0-9]{8,20}$/.test(digits) ? digits : ''
}
export function whatsappGraphVersion(){
  const value=process.env.WA_GRAPH_API_VERSION||'v23.0'
  if (!/^v\d{1,2}\.0$/.test(value)) throw new Error('INVALID_GRAPH_API_VERSION')
  return value
}
export function incomingText(message:any) {
  if (message?.type==='text') return String(message.text?.body??'').slice(0,4096)
  return '[Unsupported WhatsApp message type: '+String(message?.type??'unknown').slice(0,32)+']'
}
