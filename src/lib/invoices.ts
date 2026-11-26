// src/lib/invoices.ts
// PDF invoice generation helpers (server-side only)

import { PDFDocument, StandardFonts } from 'pdf-lib'

export type InvoiceSnapshot = {
  invoice_number: string
  issued_at: string // ISO
  gym: {
    name: string
    city?: string
    country?: string
  }
  member: {
    user_id: string
    member_code?: string | null
    first_name?: string | null
    last_name?: string | null
    email?: string | null
    joined_at?: string | null
  }
  transaction: {
    subscription_id: string
    subscription_type: string
    plan: string
    start_date: string | null
    end_date: string | null
    sessions_total: number | null
    // Amount paid so far (EGP)
    // Total is derived as: amount (paid) + amount_due (remaining due)
    amount: number
    amount_due?: number | null
    payment_method?: string | null
    currency: string
    paid_at: string
  }
  // Corrective invoice metadata. Original invoice PDFs remain immutable.
  recovery?: {
    id: string
    reason: string
    superseded_invoice_numbers: string[]
    false_payment_voided_egp: number
    outstanding_egp: number
  }
  // Optional upgrade breakdown: transferred credit is NOT an additional cash receipt.
  upgrade?: {
    from_subscription_id: string
    from_plan: string
    target_price_egp: number
    target_list_price_egp?: number
    promotion_id?: string | null
    promotion_title?: string | null
    promotion_discount_type?: string | null
    promotion_discount_value?: number | null
    promotion_discount_egp?: number
    transferred_credit_egp: number
    additional_payment_egp: number
  }
}

function humanSubscriptionPlan(plan?: string | null) {
  switch (plan) {
    case '1w': return '1 week'
    case '1m': return '1 month'
    case '3m': return '3 months'
    case '6m': return '6 months'
    case '12m': return '12 months'
    case 'sessions': return 'Legacy sessions'
    default: return plan ? String(plan) : 'Membership'
  }
}

function humanPaymentMethod(m?: string | null) {
  switch (m) {
    case 'cash':
      return 'Cash'
    case 'instapay':
      return 'InstaPay'
    case 'card':
      return 'Card'
    case 'bank_transfer':
      return 'Bank transfer'
    case 'transfer':
      return 'Bank transfer'
    case 'online':
      return 'Online'
    default:
      return m ? String(m) : '—'
  }
}

export function makeInvoiceNumber(input?: { paidAtISO?: string; subscriptionId?: string }) {
  const d = input?.paidAtISO ? new Date(input.paidAtISO) : new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const raw = (input?.subscriptionId || crypto.randomUUID()).replace(/[^a-f0-9]/gi, '')
  const suffix = raw.slice(-10).toUpperCase()
  // old suffix = (input?.subscriptionId || crypto.randomUUID()).replace(/[^a-f0-9]/gi, '').slice(0, 6).toUpperCase()
  return `INV-${y}${m}${day}-${suffix}`
}

function money(amount: number, currency: string) {
  const safe = Number.isFinite(amount) ? amount : 0
  try {
    // Use en-GB for consistent formatting
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safe)
  } catch {
    return `${safe} ${currency}`
  }
}

function fmtDate(iso: string) {
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return iso
  return dt.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })
}

function safeText(v: any) {
  const s = v === null || v === undefined ? '' : String(v)
  return s
}

export async function generateInvoicePdfBytes(snapshot: InvoiceSnapshot) {
  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([595.28, 841.89]) // A4 (pt)

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const { width, height } = page.getSize()
  const margin = 48

  const drawText = (text: string, x: number, y: number, size = 11, bold = false) => {
    page.drawText(text, {
      x,
      y,
      size,
      font: bold ? fontBold : font,
    })
  }

  // Header
  drawText(snapshot.gym.name || 'ATOM', margin, height - margin - 8, 20, true)
  drawText('INVOICE', width - margin - 90, height - margin - 2, 16, true)

  // Meta
  const metaTop = height - margin - 44
  drawText(`Invoice #: ${snapshot.invoice_number}`, margin, metaTop, 11, true)
  drawText(`Issued: ${fmtDate(snapshot.issued_at)}`, margin, metaTop - 16, 11)

  // Bill to
  const billTop = metaTop - 48
  drawText('Bill To', margin, billTop, 12, true)

  const fullName = [snapshot.member.first_name ?? '', snapshot.member.last_name ?? ''].join(' ').trim()
  const memberLine = fullName || snapshot.member.email || snapshot.member.user_id
  drawText(memberLine, margin, billTop - 18, 11)
  if (snapshot.member.member_code) {
    drawText(`Member ID: ${snapshot.member.member_code}`, margin, billTop - 34, 10)
  }
  if (snapshot.member.joined_at) {
    drawText(`First joined: ${fmtDate(snapshot.member.joined_at)}`, margin, billTop - 48, 10)
  }

  // Transaction details
  const boxTop = billTop - 88
  drawText('Transaction', margin, boxTop, 12, true)

  const leftX = margin
  const rightX = width / 2 + 10
  let y = boxTop - 18

  const row = (label: string, value: string, col: 'left' | 'right' = 'left') => {
    const x = col === 'left' ? leftX : rightX
    drawText(label, x, y, 10, true)
    drawText(value, x + 120, y, 10)
  }

  row('Plan:', humanSubscriptionPlan(snapshot.transaction.plan), 'left')
  row('Type:', safeText(snapshot.transaction.subscription_type), 'right')
  y -= 16
  row('Paid at:', fmtDate(snapshot.transaction.paid_at), 'left')

  // Business rule:
  // - transaction.amount = paid so far
  // - transaction.amount_due = remaining due
  // - total = paid + due
  const paidRaw = Number(snapshot.transaction.amount ?? 0)
  const dueRaw = Number(snapshot.transaction.amount_due ?? 0)

  const paid = Number.isFinite(paidRaw) && paidRaw > 0 ? paidRaw : 0
  const safeDue = Number.isFinite(dueRaw) && dueRaw > 0 ? dueRaw : 0
  const total = snapshot.upgrade ? Number(snapshot.upgrade.target_price_egp) : paid + safeDue

  row('Total:', money(total, snapshot.transaction.currency), 'right')

  y -= 16
  row('Payment:', humanPaymentMethod(snapshot.transaction.payment_method ?? null), 'left')
  row('Paid:', money(paid, snapshot.transaction.currency), 'right')

  y -= 16
  row('Start:', snapshot.transaction.start_date ? fmtDate(snapshot.transaction.start_date) : '—', 'left')
  row('End:', snapshot.transaction.end_date ? fmtDate(snapshot.transaction.end_date) : '—', 'right')

  y -= 16
  if (snapshot.transaction.sessions_total !== null && snapshot.transaction.sessions_total !== undefined) {
    row('Sessions:', String(snapshot.transaction.sessions_total), 'left')
  }
  row('Due:', money(safeDue, snapshot.transaction.currency), 'right')

  y -= 16
  if (snapshot.upgrade) {
    const promotionDiscount = Number(snapshot.upgrade.promotion_discount_egp ?? 0)
    if (promotionDiscount > 0) {
      y -= 16
      row('Plan list price:', money(Number(snapshot.upgrade.target_list_price_egp ?? total), snapshot.transaction.currency), 'left')
      row('Promotion:', '-' + money(promotionDiscount, snapshot.transaction.currency), 'right')
    }
    y -= 18
    row('Previous plan:', humanSubscriptionPlan(snapshot.upgrade.from_plan), 'left')
    row('Credit applied:', money(snapshot.upgrade.transferred_credit_egp, snapshot.transaction.currency), 'right')
    y -= 16
    row('New cash paid:', money(snapshot.upgrade.additional_payment_egp, snapshot.transaction.currency), 'left')
    y -= 16
    drawText('Credit is not a cash receipt.', margin, y, 9)
  }
  y -= 18
  row('Subscription ID:', snapshot.transaction.subscription_id, 'left')

  if (snapshot.recovery) {
    y -= 34
    drawText('CORRECTIVE INVOICE - NO ADDITIONAL PAYMENT COLLECTED',margin,y,11,true)
    y -= 18
    if (snapshot.recovery.false_payment_voided_egp > 0) {
      drawText('Actual deposit: 23 Nov 2026; correction excludes the erroneous EGP 400 entry.',margin,y,9)
    } else {
      drawText(snapshot.recovery.reason,margin,y,9)
    }
    y -= 16
    drawText('Outstanding payment due: '+money(snapshot.recovery.outstanding_egp,snapshot.transaction.currency),margin,y,9,true)
    y -= 16
    drawText('Previously issued documents retained as superseded historical records:',margin,y,9)
    for (const invoice of snapshot.recovery.superseded_invoice_numbers) {
      y -= 14
      drawText(invoice,margin+12,y,9)
    }
  }

  // Footer
  const footer = `Generated by ATOM App · ${snapshot.gym.city ? snapshot.gym.city + ', ' : ''}${snapshot.gym.country ?? ''}`.trim()
  drawText(footer, margin, margin - 10, 9)

  const bytes = await pdfDoc.save()
  return bytes
}
