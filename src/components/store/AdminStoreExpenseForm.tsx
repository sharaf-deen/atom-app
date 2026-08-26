'use client'

import { useMemo, useState, type ReactNode } from 'react'
import ConfirmSubmitButton from '@/components/ui/ConfirmSubmitButton'
import { parsePriceToCents, toPriceString } from '@/lib/money'

type Option = { value: string; label: string }

type SupplierOrderOption = Option & {
  supplierName?: string | null
  status?: string | null
  totalCents?: number | null
}

type Defaults = {
  supplierOrderId?: string
  title?: string
  vendorName?: string
  amount?: string
  note?: string
}

type Props = {
  action: (formData: FormData) => void | Promise<void>
  returnQueryString: string
  today: string
  categories: Option[]
  paymentMethods: Option[]
  supplierOrders: SupplierOrderOption[]
  defaults?: Defaults
}

function normalizeDecimalInput(value: string) {
  const raw = String(value || '').trim()
  if (!raw) return raw

  let cleaned = raw.replace(/\s+/g, '').replace(/[^0-9.,-]/g, '')
  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.')
    } else {
      cleaned = cleaned.replace(/,/g, '')
    }
  } else if (lastComma >= 0) {
    cleaned = cleaned.replace(',', '.')
  }

  return cleaned
}

function formatMoney(cents: number) {
  return `${toPriceString(Math.max(0, Math.round(cents)))} EGP`
}

function labelFromOptions(options: Option[], value: string, fallback = '—') {
  return options.find((option) => option.value === value)?.label ?? fallback
}

function statusLabel(value?: string | null) {
  const clean = String(value || '').trim()
  if (!clean) return 'status unknown'
  return clean.replace(/_/g, ' ')
}

export default function AdminStoreExpenseForm({
  action,
  returnQueryString,
  today,
  categories,
  paymentMethods,
  supplierOrders,
  defaults,
}: Props) {
  const [expenseDate, setExpenseDate] = useState(today)
  const [category, setCategory] = useState('supplier_order')
  const [title, setTitle] = useState(defaults?.title ?? '')
  const [amount, setAmount] = useState(defaults?.amount ?? '')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [vendorName, setVendorName] = useState(defaults?.vendorName ?? '')
  const [supplierOrderId, setSupplierOrderId] = useState(defaults?.supplierOrderId ?? '')
  const [note, setNote] = useState(defaults?.note ?? '')
  const [optionalOpen, setOptionalOpen] = useState(Boolean(defaults?.note))

  const selectedSupplierOrder = useMemo(() => {
    if (!supplierOrderId) return null
    return supplierOrders.find((order) => order.value === supplierOrderId) ?? null
  }, [supplierOrderId, supplierOrders])

  const amountCents = useMemo(() => {
    const cents = parsePriceToCents(normalizeDecimalInput(amount))
    return Number.isFinite(cents) ? Math.max(0, cents) : 0
  }, [amount])

  const linkedOrderTotalCents = Math.max(0, Number(selectedSupplierOrder?.totalCents ?? 0))
  const linkedOrderDifferenceCents = amountCents - linkedOrderTotalCents
  const hasAmount = amountCents > 0
  const categoryPreview = labelFromOptions(categories, category, category || '—')
  const paymentPreview = labelFromOptions(paymentMethods, paymentMethod, paymentMethod || '—')
  const supplierPreview = selectedSupplierOrder?.label || 'No supplier order link'

  function useSupplierEstimate() {
    if (!selectedSupplierOrder) return
    if (selectedSupplierOrder.totalCents && selectedSupplierOrder.totalCents > 0) {
      setAmount(toPriceString(selectedSupplierOrder.totalCents))
    }
    if (!vendorName.trim() && selectedSupplierOrder.supplierName) {
      setVendorName(selectedSupplierOrder.supplierName)
    }
    if (!title.trim()) {
      setTitle(`Supplier order ${selectedSupplierOrder.label.split(' · ')[0] || selectedSupplierOrder.value.slice(0, 8)}`)
    }
    if (!note.trim()) {
      setNote(`Linked supplier order: ${selectedSupplierOrder.label}`)
    }
  }

  return (
    <CardLike>
      <div className="border-b border-[hsl(var(--border))] px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-black">Quick store expense</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              Record the cash/card/bank impact first. Supplier links, note, and attachment stay optional.
            </p>
          </div>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
            Super admin only
          </span>
        </div>
      </div>

      <form action={action} className="space-y-4 p-4 sm:p-5">
        <input type="hidden" name="return_qs" value={returnQueryString} />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.42fr)]">
          <div className="space-y-4">
            <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-black">Essential expense details</div>
                  <div className="text-xs text-[hsl(var(--muted))]">Date, category, title, amount, and payment method.</div>
                </div>
                <span className="rounded-full bg-[hsl(var(--bg))] px-3 py-1 text-xs font-medium text-[hsl(var(--muted))]">
                  EGP only
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Date</span>
                  <input
                    type="date"
                    name="expense_date"
                    value={expenseDate}
                    onChange={(event) => setExpenseDate(event.target.value)}
                    className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Category</span>
                  <select
                    name="category"
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    required
                    className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Amount paid</span>
                  <input
                    type="number"
                    name="amount"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="0.00"
                    required
                    className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none placeholder:text-[hsl(var(--muted))] focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Payment method</span>
                  <select
                    name="payment_method"
                    value={paymentMethod}
                    onChange={(event) => setPaymentMethod(event.target.value)}
                    required
                    className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {paymentMethods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>

                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-sm font-medium">Title</span>
                  <input
                    name="title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Example: Pakistan factory order"
                    required
                    className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none placeholder:text-[hsl(var(--muted))] focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>

                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-sm font-medium">Vendor / supplier</span>
                  <input
                    name="vendor_name"
                    value={vendorName}
                    onChange={(event) => setVendorName(event.target.value)}
                    placeholder="Optional vendor or supplier name"
                    className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none placeholder:text-[hsl(var(--muted))] focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>
              </div>
            </div>

            <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-black">Supplier order link</div>
                  <div className="text-xs text-[hsl(var(--muted))]">Optional accounting link only. It does not update stock or supplier-order status.</div>
                </div>
                {selectedSupplierOrder ? (
                  <button
                    type="button"
                    onClick={useSupplierEstimate}
                    className="inline-flex items-center justify-center rounded-2xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-xs font-semibold shadow-soft hover:bg-[hsl(var(--bg))]/80"
                  >
                    Use order estimate
                  </button>
                ) : null}
              </div>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Related supplier order</span>
                <select
                  name="supplier_order_id"
                  value={supplierOrderId}
                  onChange={(event) => setSupplierOrderId(event.target.value)}
                  className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">No supplier order link</option>
                  {supplierOrders.map((order) => <option key={order.value} value={order.value}>{order.label}</option>)}
                </select>
              </label>

              {selectedSupplierOrder ? (
                <div className="mt-3 grid gap-2 rounded-2xl border border-sky-100 bg-sky-50/70 p-3 text-xs text-sky-900 sm:grid-cols-3">
                  <div>
                    <div className="font-semibold">Supplier</div>
                    <div>{selectedSupplierOrder.supplierName || '—'}</div>
                  </div>
                  <div>
                    <div className="font-semibold">Order status</div>
                    <div className="capitalize">{statusLabel(selectedSupplierOrder.status)}</div>
                  </div>
                  <div>
                    <div className="font-semibold">Estimated order total</div>
                    <div>{formatMoney(linkedOrderTotalCents)}</div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
              <button
                type="button"
                onClick={() => setOptionalOpen((open) => !open)}
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                <span>
                  <span className="block text-sm font-semibold text-black">Optional expense details</span>
                  <span className="block text-xs text-[hsl(var(--muted))]">Add a note or upload proof. JPG, PNG, WEBP, or PDF up to 8MB.</span>
                </span>
                <span className="rounded-full border border-[hsl(var(--border))] px-3 py-1 text-xs font-semibold text-[hsl(var(--muted))]">
                  {optionalOpen ? 'Hide' : 'Show'}
                </span>
              </button>

              {optionalOpen ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-sm font-medium">Note</span>
                    <textarea
                      name="note"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      rows={3}
                      placeholder="Optional internal note…"
                      className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none placeholder:text-[hsl(var(--muted))] focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>

                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-sm font-medium">Attachment</span>
                    <input
                      type="file"
                      name="attachment"
                      accept="image/*,application/pdf"
                      className="block w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-black file:px-3 file:py-2 file:text-white"
                    />
                    <span className="mt-1 block text-xs text-[hsl(var(--muted))]">Accepted: JPG, PNG, WEBP, PDF. Max 8MB.</span>
                  </label>
                </div>
              ) : (
                <input type="hidden" name="note" value={note} />
              )}
            </div>
          </div>

          <aside className="space-y-3">
            <div className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))]/60 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Expense preview</div>
              <div className="mt-2 text-2xl font-semibold text-black">{hasAmount ? formatMoney(amountCents) : '—'}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">{categoryPreview} · {paymentPreview}</div>

              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-[hsl(var(--muted))]">Date</dt>
                  <dd className="text-right font-medium text-black">{expenseDate || '—'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[hsl(var(--muted))]">Title</dt>
                  <dd className="max-w-[13rem] truncate text-right font-medium text-black">{title.trim() || 'Required'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[hsl(var(--muted))]">Vendor</dt>
                  <dd className="max-w-[13rem] truncate text-right font-medium text-black">{vendorName.trim() || '—'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[hsl(var(--muted))]">Supplier order</dt>
                  <dd className="max-w-[13rem] truncate text-right font-medium text-black">{supplierPreview}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <div className="font-semibold">Cash impact</div>
              <p className="mt-1">
                This creates one Store expense and reduces Net store cash visibility by {hasAmount ? formatMoney(amountCents) : 'the entered amount'}.
              </p>
              <p className="mt-2 text-xs">No stock, supplier receiving, sales, preorders, funding, or reconciliation action is triggered.</p>
            </div>

            {selectedSupplierOrder && linkedOrderTotalCents > 0 ? (
              <div className={`rounded-3xl border p-4 text-sm ${linkedOrderDifferenceCents === 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-sky-200 bg-sky-50 text-sky-900'}`}>
                <div className="font-semibold">Linked order check</div>
                <p className="mt-1">
                  {linkedOrderDifferenceCents === 0
                    ? 'Amount matches the linked supplier order estimate.'
                    : `Difference vs order estimate: ${linkedOrderDifferenceCents > 0 ? '+' : '-'}${formatMoney(Math.abs(linkedOrderDifferenceCents))}.`}
                </p>
              </div>
            ) : null}
          </aside>
        </div>

        <div className="space-y-2 border-t border-[hsl(var(--border))] pt-4">
          <ConfirmSubmitButton
            confirmTitle="Confirm store expense"
            confirmDescription="Please review this expense before saving. It affects Store expenses and Net store cash only."
            confirmButtonLabel="Confirm & save expense"
            pendingLabel="Saving…"
            staticItems={[
              { label: 'Impact', value: 'Affects Store expenses and Net store cash only' },
              { label: 'No stock update', value: 'Supplier receiving and product stock stay unchanged' },
            ]}
            fieldItems={[
              { label: 'Date', name: 'expense_date', kind: 'date' },
              { label: 'Category', name: 'category', kind: 'select' },
              { label: 'Title', name: 'title', emptyValue: 'Required' },
              { label: 'Amount', name: 'amount', kind: 'egp' },
              { label: 'Payment', name: 'payment_method', kind: 'select' },
              { label: 'Supplier order', name: 'supplier_order_id', kind: 'select', emptyValue: 'No supplier order link', maxLength: 90 },
              { label: 'Vendor / supplier', name: 'vendor_name', emptyValue: '—' },
              { label: 'Note', name: 'note', emptyValue: '—', maxLength: 90 },
              { label: 'Attachment', name: 'attachment', kind: 'file', emptyValue: 'No' },
            ]}
          >
            Review & save expense
          </ConfirmSubmitButton>
          <p className="text-xs text-[hsl(var(--muted))]">Uploading attachment and saving after confirmation. Please avoid tapping twice.</p>
        </div>
      </form>
    </CardLike>
  )
}

function CardLike({ children }: { children: ReactNode }) {
  return <div className="rounded-3xl border border-[hsl(var(--border))] bg-white shadow-soft">{children}</div>
}
