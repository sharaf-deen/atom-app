// Staff Payroll 1F — Salary Statement PDF
// Server-side PDF generation for immutable approved payroll calculations.

import { PDFDocument, PDFFont, PDFImage, StandardFonts, rgb } from 'pdf-lib'

export type StaffPayrollStatementPayment = {
  id: string
  amount: number
  payment_method: string
  payment_date: string
  reference: string | null
  note: string | null
  status: 'active' | 'reversed' | string
  recorded_at: string
  recorded_by_name_snapshot: string
  reversed_at: string | null
  reversed_by_name_snapshot: string | null
  reversal_reason: string | null
}

export type StaffPayrollStatementSnapshot = {
  generated_at: string
  month_start: string
  approval_version: {
    id: string
    version_no: number
    approved_at: string
    approved_by_name_snapshot: string
    version_status_label: string
  }
  staff: {
    user_id: string
    name: string
    role: string | null
  }
  compensation: {
    fixed_monthly_base: number
    weighted_hour_rate: number
    actual_hours: number
    weighted_hours: number
    task_compensation: number
    performance_bonus: number
    approved_salary: number
  }
  payments: StaffPayrollStatementPayment[]
  totals: {
    paid: number
    remaining: number
    payment_status: 'unpaid' | 'partially_paid' | 'paid'
  }
}

function money(value: number) {
  const safe = Number.isFinite(Number(value)) ? Number(value) : 0
  return `${safe.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} EGP`
}

function number(value: number) {
  const safe = Number.isFinite(Number(value)) ? Number(value) : 0
  return safe.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function monthLabel(monthStart: string) {
  const match = /^(\d{4})-(\d{2})/.exec(monthStart)
  if (!match) return monthStart
  const year = Number(match[1])
  const month = Number(match[2])
  if (!year || month < 1 || month > 12) return monthStart
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

function dateLabel(value: string | null) {
  if (!value) return '-'
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: value.length === 10 ? 'UTC' : 'Africa/Cairo',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function dateTimeLabel(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function roleLabel(role: string | null) {
  switch (role) {
    case 'super_admin':
      return 'Super Admin'
    case 'admin':
      return 'Admin'
    case 'reception':
      return 'Reception'
    case 'head_coach':
      return 'Head Coach'
    case 'assistant_coach':
      return 'Assistant Coach'
    case 'coach':
      return 'Coach'
    default:
      return role || 'Staff'
  }
}

function methodLabel(method: string) {
  switch (method) {
    case 'cash':
      return 'Cash'
    case 'instapay':
      return 'Instapay'
    case 'bank_transfer':
      return 'Bank Transfer'
    default:
      return method || '-'
  }
}

function statusLabel(status: StaffPayrollStatementSnapshot['totals']['payment_status']) {
  if (status === 'paid') return 'Paid'
  if (status === 'partially_paid') return 'Partially Paid'
  return 'Unpaid'
}

function pdfSafeText(font: PDFFont, value: unknown) {
  const input = value === null || value === undefined ? '' : String(value)
  let output = ''
  for (const char of input) {
    try {
      font.encodeText(char)
      output += char
    } catch {
      output += '?'
    }
  }
  return output
}

function wrapText(font: PDFFont, value: string, size: number, maxWidth: number) {
  const safe = pdfSafeText(font, value).replace(/\s+/g, ' ').trim()
  if (!safe) return ['']

  const words = safe.split(' ')
  const lines: string[] = []
  let line = ''

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate
      continue
    }

    if (line) lines.push(line)

    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      line = word
      continue
    }

    let part = ''
    for (const char of word) {
      const next = `${part}${char}`
      if (font.widthOfTextAtSize(next, size) > maxWidth && part) {
        lines.push(part)
        part = char
      } else {
        part = next
      }
    }
    line = part
  }

  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

export async function generateStaffPayrollStatementPdfBytes(
  snapshot: StaffPayrollStatementSnapshot,
  logoBytes?: Uint8Array | null
) {
  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const pageSize: [number, number] = [595.28, 841.89]
  const margin = 44
  const contentWidth = pageSize[0] - margin * 2
  const muted = rgb(0.38, 0.41, 0.45)
  const light = rgb(0.94, 0.95, 0.96)
  const dark = rgb(0.08, 0.09, 0.1)
  const green = rgb(0.08, 0.42, 0.23)

  let page = pdfDoc.addPage(pageSize)
  let y = pageSize[1] - margin
  let pageNumber = 1

  let embeddedLogo: PDFImage | null = null
  if (logoBytes?.length) {
    try {
      embeddedLogo = await pdfDoc.embedPng(logoBytes)
    } catch {
      embeddedLogo = null
    }
  }

  const draw = (
    text: string,
    x: number,
    atY: number,
    size = 10,
    bold = false,
    color = dark
  ) => {
    const activeFont = bold ? fontBold : font
    page.drawText(pdfSafeText(activeFont, text), {
      x,
      y: atY,
      size,
      font: activeFont,
      color,
    })
  }

  const drawWrapped = (
    text: string,
    x: number,
    atY: number,
    maxWidth: number,
    size = 9,
    lineHeight = 12,
    bold = false,
    color = dark
  ) => {
    const activeFont = bold ? fontBold : font
    const lines = wrapText(activeFont, text, size, maxWidth)
    lines.forEach((line, index) => draw(line, x, atY - index * lineHeight, size, bold, color))
    return lines.length * lineHeight
  }

  const footer = () => {
    draw(`Generated by ATOM App · Page ${pageNumber}`, margin, 26, 8, false, muted)
  }

  const newPage = () => {
    footer()
    page = pdfDoc.addPage(pageSize)
    pageNumber += 1
    y = pageSize[1] - margin
    draw('ATOM JIU-JITSU · SALARY STATEMENT', margin, y, 11, true)
    y -= 26
  }

  const ensureSpace = (needed: number) => {
    if (y - needed < 48) newPage()
  }

  const sectionTitle = (title: string) => {
    ensureSpace(30)
    page.drawRectangle({ x: margin, y: y - 4, width: contentWidth, height: 22, color: light })
    draw(title, margin + 8, y + 2, 10, true)
    y -= 30
  }

  const keyValue = (label: string, value: string, x: number, valueX: number, atY: number) => {
    draw(label, x, atY, 9, true, muted)
    draw(value, valueX, atY, 9)
  }

  // Header
  if (embeddedLogo) {
    const dims = embeddedLogo.scaleToFit(112, 28)
    page.drawImage(embeddedLogo, {
      x: margin,
      y: pageSize[1] - margin - dims.height + 3,
      width: dims.width,
      height: dims.height,
    })
  } else {
    draw('ATOM JIU-JITSU', margin, y, 18, true)
  }

  draw('SALARY STATEMENT', pageSize[0] - margin - 145, y, 15, true)
  y -= 32
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageSize[0] - margin, y },
    thickness: 1,
    color: rgb(0.82, 0.83, 0.85),
  })
  y -= 24

  draw(snapshot.staff.name, margin, y, 16, true)
  draw(roleLabel(snapshot.staff.role), margin, y - 17, 9, false, muted)
  draw(monthLabel(snapshot.month_start), pageSize[0] - margin - 150, y, 12, true)
  draw(
    `Approval V${snapshot.approval_version.version_no}`,
    pageSize[0] - margin - 150,
    y - 17,
    9,
    false,
    muted
  )
  y -= 56

  sectionTitle('Approval')
  keyValue('Approved:', dateTimeLabel(snapshot.approval_version.approved_at), margin, margin + 80, y)
  keyValue(
    'Approved by:',
    snapshot.approval_version.approved_by_name_snapshot,
    margin + 260,
    margin + 340,
    y
  )
  y -= 16
  keyValue('Version:', `V${snapshot.approval_version.version_no}`, margin, margin + 80, y)
  keyValue('Status:', snapshot.approval_version.version_status_label, margin + 260, margin + 340, y)
  y -= 26

  sectionTitle('Approved compensation')
  const col1 = margin
  const col2 = margin + 260
  const value1 = margin + 135
  const value2 = margin + 390

  keyValue('Fixed monthly base:', money(snapshot.compensation.fixed_monthly_base), col1, value1, y)
  keyValue('Actual hours:', number(snapshot.compensation.actual_hours), col2, value2, y)
  y -= 16
  keyValue('Weighted-hour rate:', money(snapshot.compensation.weighted_hour_rate), col1, value1, y)
  keyValue('Weighted hours:', number(snapshot.compensation.weighted_hours), col2, value2, y)
  y -= 16
  keyValue('Task compensation:', money(snapshot.compensation.task_compensation), col1, value1, y)
  keyValue('Performance bonus:', money(snapshot.compensation.performance_bonus), col2, value2, y)
  y -= 30

  page.drawRectangle({ x: margin, y: y - 7, width: contentWidth, height: 36, color: rgb(0.92, 0.97, 0.94) })
  draw('APPROVED SALARY', margin + 10, y + 7, 11, true, green)
  draw(money(snapshot.compensation.approved_salary), pageSize[0] - margin - 150, y + 7, 13, true, green)
  y -= 48

  sectionTitle('Payment status')
  const status = statusLabel(snapshot.totals.payment_status)
  keyValue('Status:', status, margin, margin + 80, y)
  keyValue('Total paid:', money(snapshot.totals.paid), margin + 190, margin + 275, y)
  keyValue('Remaining:', money(snapshot.totals.remaining), margin + 365, margin + 440, y)
  y -= 28

  sectionTitle('Payment history')

  if (!snapshot.payments.length) {
    draw('No salary payments recorded for this approval version.', margin, y, 9, false, muted)
    y -= 22
  } else {
    for (const payment of snapshot.payments) {
      const isReversed = payment.status === 'reversed'
      const baseHeight = 47
      const referenceHeight = payment.reference ? 12 : 0
      const noteHeight = payment.note ? 24 : 0
      const reversalHeight = isReversed ? 36 : 0
      const needed = baseHeight + referenceHeight + noteHeight + reversalHeight
      ensureSpace(needed)

      page.drawRectangle({
        x: margin,
        y: y - needed + 8,
        width: contentWidth,
        height: needed - 4,
        borderWidth: 0.6,
        borderColor: rgb(0.82, 0.83, 0.85),
      })

      draw(
        `${money(payment.amount)} · ${methodLabel(payment.payment_method)}`,
        margin + 9,
        y - 10,
        10,
        true,
        isReversed ? muted : dark
      )
      draw(dateLabel(payment.payment_date), pageSize[0] - margin - 95, y - 10, 9, false, muted)
      draw(
        isReversed ? 'REVERSED' : 'ACTIVE',
        margin + 9,
        y - 25,
        8,
        true,
        isReversed ? muted : green
      )
      draw(
        `Recorded by ${payment.recorded_by_name_snapshot} · ${dateTimeLabel(payment.recorded_at)}`,
        margin + 82,
        y - 25,
        8,
        false,
        muted
      )

      let detailY = y - 39
      if (payment.reference) {
        drawWrapped(`Reference: ${payment.reference}`, margin + 9, detailY, contentWidth - 18, 8, 10)
        detailY -= 12
      }
      if (payment.note) {
        const used = drawWrapped(`Note: ${payment.note}`, margin + 9, detailY, contentWidth - 18, 8, 10)
        detailY -= Math.max(12, used)
      }
      if (isReversed) {
        const reason = payment.reversal_reason || 'No reversal reason recorded.'
        const used = drawWrapped(`Reversal reason: ${reason}`, margin + 9, detailY, contentWidth - 18, 8, 10, true, muted)
        detailY -= Math.max(12, used)
        draw(
          `Reversed ${dateTimeLabel(payment.reversed_at)}${payment.reversed_by_name_snapshot ? ` by ${payment.reversed_by_name_snapshot}` : ''}`,
          margin + 9,
          detailY,
          8,
          false,
          muted
        )
      }

      y -= needed
    }
  }

  ensureSpace(66)
  y -= 6
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageSize[0] - margin, y },
    thickness: 0.7,
    color: rgb(0.82, 0.83, 0.85),
  })
  y -= 18
  const disclaimer =
    'This statement reflects the immutable approved payroll calculation and the salary payment records stored in ATOM App at the time of generation. It does not modify payroll or payment data.'
  const disclaimerHeight = drawWrapped(disclaimer, margin, y, contentWidth, 8, 11, false, muted)
  y -= disclaimerHeight + 8
  draw(`Generated: ${dateTimeLabel(snapshot.generated_at)}`, margin, y, 8, false, muted)

  footer()
  return pdfDoc.save()
}
