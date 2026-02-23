'use client'

import { useMemo, useState } from 'react'
import Modal from '@/components/ui/Modal'

export type ExpenseRow = {
  id: string
  date: string
  category_key: string | null
  description: string | null
  amount: number
  payment_method?: string | null
  receipt_path?: string | null
  receipt_mime?: string | null
  receipt_filename?: string | null
}

type Props = {
  expenses: ExpenseRow[]
  labelByKey: Record<string, string>
}

function formatEGP(n: number) {
  const safe = Number.isFinite(n) ? n : 0
  return new Intl.NumberFormat('en-EG', {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 2,
  }).format(safe)
}

function isImageReceipt(mime?: string | null, path?: string | null) {
  const m = (mime || '').toLowerCase()
  if (m.startsWith('image/')) return true
  const p = (path || '').toLowerCase()
  return p.endsWith('.png') || p.endsWith('.jpg') || p.endsWith('.jpeg') || p.endsWith('.webp') || p.endsWith('.gif')
}

function paymentLabel(v?: string | null) {
  const s = (v || '').trim()
  if (!s) return '—'
  if (s === 'cash') return 'Cash'
  if (s === 'visa') return 'Visa card'
  if (s === 'instapay') return 'Instapay'
  if (s === 'bank_transfer') return 'Bank transfer'
  return s.replaceAll('_', ' ')
}

export default function ExpensesTableClient({ expenses, labelByKey }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<
    | null
    | {
        id: string
        url: string
        filename?: string | null
        mime?: string | null
        path?: string | null
      }
  >(null)

  const activeIsImage = useMemo(() => {
    if (!active) return false
    return isImageReceipt(active.mime, active.path)
  }, [active])

  function openPreview(e: ExpenseRow) {
    const url = `/api/expenses/${e.id}/receipt`
    setActive({ id: e.id, url, filename: e.receipt_filename, mime: e.receipt_mime, path: e.receipt_path })
    setOpen(true)
  }

  function close() {
    setOpen(false)
    // keep active to avoid iframe reload flicker if reopened quickly
  }

  return (
    <>
      {expenses.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted))]">No expenses in this range.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-[hsl(var(--border))]">
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Category</th>
                <th className="py-2 pr-3">Description</th>
                <th className="py-2 pr-3">Payment</th>
                <th className="py-2 pr-3">Receipt</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className="border-b border-[hsl(var(--border))]/60">
                  <td className="py-2 pr-3 whitespace-nowrap">{e.date}</td>
                  <td className="py-2 pr-3">
                    {e.category_key ? labelByKey[e.category_key] ?? e.category_key : '—'}
                  </td>
                  <td className="py-2 pr-3 text-[hsl(var(--muted))]">{e.description ?? '—'}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{paymentLabel(e.payment_method)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {e.receipt_path ? (
                      <div className="flex items-center gap-2">
                        {isImageReceipt(e.receipt_mime, e.receipt_path) ? (
                          <button
                            type="button"
                            onClick={() => openPreview(e)}
                            className="rounded-lg border border-[hsl(var(--border))] overflow-hidden h-8 w-8"
                            title="Preview receipt"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/expenses/${e.id}/receipt`}
                              alt={e.receipt_filename ? `Receipt ${e.receipt_filename}` : 'Receipt'}
                              className="h-8 w-8 object-cover"
                              loading="lazy"
                            />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openPreview(e)}
                            className="text-[11px] px-2 py-1 rounded-xl border border-[hsl(var(--border))] bg-white"
                            title="Preview receipt (PDF)"
                          >
                            PDF
                          </button>
                        )}

                        <button type="button" className="text-xs underline" onClick={() => openPreview(e)}>
                          Preview
                        </button>
                      </div>
                    ) : (
                      <span className="text-[hsl(var(--muted))]">—</span>
                    )}
                  </td>
                  <td className="py-2 text-right font-medium">{formatEGP(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        onClose={close}
        title={active?.filename ? `Receipt · ${active.filename}` : 'Receipt'}
        className="w-[min(95vw,56rem)]"
      >
        {!active ? null : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-[hsl(var(--muted))] truncate">{active.filename || active.url}</div>
              <div className="flex items-center gap-2">
                <a
                  href={active.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline"
                  title="Open in new tab"
                >
                  Open
                </a>
                <button
                  type="button"
                  onClick={close}
                  className="rounded-xl border border-[hsl(var(--border))] px-3 py-1 text-xs"
                >
                  Close
                </button>
              </div>
            </div>

            {activeIsImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={active.url}
                alt={active.filename ? `Receipt ${active.filename}` : 'Receipt'}
                className="w-full max-h-[70vh] object-contain rounded-xl border border-[hsl(var(--border))]"
              />
            ) : (
              <iframe
                src={active.url}
                title="Receipt PDF"
                className="w-full h-[70vh] rounded-xl border border-[hsl(var(--border))]"
              />
            )}
          </div>
        )}
      </Modal>
    </>
  )
}
