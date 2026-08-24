'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'

type ReceiptItem = {
  productName: string | null
  qty: number
  unitPriceCents: number
  lineTotalCents: number
  currency: string | null
  stockApplied: boolean
}

type Props = {
  saleId: string
  purchaseDate: string | null
  createdAt: string
  buyerFullName: string | null
  buyerEmail: string | null
  buyerPhone: string | null
  status: string
  paymentMethod: string | null
  currency: string | null
  totalCents: number
  discountCents: number | null
  paidCents: number
  debtCents: number
  items: ReceiptItem[]
}

function formatMoney(cents: number | null | undefined, currency = 'EGP') {
  const safeCents = Math.max(0, Math.floor(Number(cents || 0)))
  try {
    return new Intl.NumberFormat('en-EG', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safeCents / 100)
  } catch {
    return `${(safeCents / 100).toFixed(2)} ${currency}`
  }
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  const d = value.includes('T') ? new Date(value) : new Date(`${value}T00:00:00`)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&#039;'
      default:
        return char
    }
  })
}

function paymentLabel(value: string | null) {
  switch (value) {
    case 'cash':
      return 'Cash'
    case 'card':
      return 'Card'
    case 'bank_transfer':
      return 'Bank transfer'
    case 'instapay':
      return 'Instapay'
    default:
      return '—'
  }
}

function statusLabel(value: string) {
  switch (value) {
    case 'draft':
      return 'Draft'
    case 'partial_paid':
      return 'Partial paid'
    case 'paid':
      return 'Paid'
    case 'delivered':
      return 'Delivered'
    case 'canceled':
      return 'Canceled'
    default:
      return value || '—'
  }
}

export default function AdminSaleReceipt({
  saleId,
  purchaseDate,
  createdAt,
  buyerFullName,
  buyerEmail,
  buyerPhone,
  status,
  paymentMethod,
  currency,
  totalCents,
  discountCents,
  paidCents,
  debtCents,
  items,
}: Props) {
  const [copied, setCopied] = useState(false)
  const displayCurrency = currency || 'EGP'
  const safeDebtCents = Math.max(0, Math.floor(Number(debtCents || 0)))
  const receiptType = safeDebtCents > 0 ? 'Payment proof / balance due' : 'Store receipt'

  const receiptText = useMemo(() => {
    const itemLines = items.length > 0
      ? items.map((item, index) => {
          const itemCurrency = item.currency || displayCurrency
          return `${index + 1}. ${item.productName || 'Product'} — Qty ${item.qty} × ${formatMoney(item.unitPriceCents, itemCurrency)} = ${formatMoney(item.lineTotalCents, itemCurrency)}`
        })
      : ['No items']

    return [
      'ATOM Jiu-Jitsu',
      receiptType,
      '',
      `Sale ID: ${saleId}`,
      `Sale date: ${formatDate(purchaseDate || createdAt)}`,
      `Created: ${formatDate(createdAt)}`,
      '',
      `Buyer: ${buyerFullName || 'Buyer'}`,
      `Phone: ${buyerPhone || '—'}`,
      `Email: ${buyerEmail || '—'}`,
      '',
      'Items:',
      ...itemLines,
      '',
      `Subtotal / total: ${formatMoney(totalCents, displayCurrency)}`,
      `Discount: ${formatMoney(discountCents || 0, displayCurrency)}`,
      `Paid: ${formatMoney(paidCents, displayCurrency)}`,
      `Remaining debt: ${formatMoney(safeDebtCents, displayCurrency)}`,
      `Payment method: ${paymentLabel(paymentMethod)}`,
      `Status: ${statusLabel(status)}`,
      '',
      safeDebtCents > 0
        ? `Balance due: ${formatMoney(safeDebtCents, displayCurrency)}`
        : 'Balance due: 0.00',
      '',
      'Thank you.',
    ].join('\n')
  }, [buyerEmail, buyerFullName, buyerPhone, createdAt, discountCents, displayCurrency, items, paidCents, paymentMethod, purchaseDate, receiptType, safeDebtCents, saleId, status, totalCents])

  async function copyReceipt() {
    try {
      await navigator.clipboard.writeText(receiptText)
      setCopied(true)
      toast.success('Receipt copied')
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      try {
        const textarea = document.createElement('textarea')
        textarea.value = receiptText
        textarea.setAttribute('readonly', 'true')
        textarea.style.position = 'fixed'
        textarea.style.left = '-9999px'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
        setCopied(true)
        toast.success('Receipt copied')
        window.setTimeout(() => setCopied(false), 1800)
      } catch {
        toast.error('Copy failed')
      }
    }
  }

  function printReceipt() {
    const printWindow = window.open('', '_blank', 'noopener,noreferrer')
    if (!printWindow) {
      toast.error('Print window was blocked. Copy receipt instead.')
      return
    }

    printWindow.document.write(`<!doctype html>
<html>
<head>
  <title>ATOM Store Receipt</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: Arial, sans-serif; margin: 32px; color: #111; }
    .receipt { max-width: 520px; margin: 0 auto; border: 1px solid #ddd; border-radius: 16px; padding: 24px; }
    pre { white-space: pre-wrap; font-family: Arial, sans-serif; font-size: 14px; line-height: 1.55; margin: 0; }
    @media print { body { margin: 0; } .receipt { border: 0; border-radius: 0; } }
  </style>
</head>
<body>
  <div class="receipt"><pre>${escapeHtml(receiptText)}</pre></div>
</body>
</html>`)
    printWindow.document.close()
    printWindow.focus()
    window.setTimeout(() => printWindow.print(), 150)
  }

  return (
    <div className="rounded-2xl border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Receipt / payment proof</div>
          <div className="text-xs text-[hsl(var(--muted))]">Copy a WhatsApp-ready receipt or print a simple browser receipt.</div>
        </div>
        <span className="rounded-full border px-2.5 py-1 text-xs text-[hsl(var(--muted))]">No data change</span>
      </div>

      <div className="mt-3 rounded-2xl border bg-[hsl(var(--bg))] p-3">
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-5 text-[hsl(var(--fg))]">{receiptText}</pre>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copyReceipt}
          className="rounded-xl bg-black px-3 py-2 text-sm font-medium text-white transition hover:bg-black/85"
        >
          {copied ? 'Copied' : 'Copy receipt'}
        </button>
        <button
          type="button"
          onClick={printReceipt}
          className="rounded-xl border px-3 py-2 text-sm font-medium transition hover:bg-gray-50"
        >
          Print receipt
        </button>
      </div>
    </div>
  )
}
