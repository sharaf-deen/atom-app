'use client'

import { useMemo, useState, type ReactNode } from 'react'
import ConfirmSubmitButton from '@/components/ui/ConfirmSubmitButton'
import { parsePriceToCents, toPriceString } from '@/lib/money'

type Option = { value: string; label: string }

type Props = {
  action: (formData: FormData) => void | Promise<void>
  returnQueryString: string
  today: string
  fundingTypes: Option[]
  paymentMethods: Option[]
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

function shortValue(value: string, fallback = '—') {
  const text = String(value || '').trim()
  if (!text) return fallback
  return text.length > 44 ? `${text.slice(0, 44).trim()}…` : text
}

function impactDetails(type: string, amountCents: number) {
  const amount = formatMoney(amountCents)

  if (type === 'loan_repayment') {
    return {
      cash: amountCents > 0 ? `-${amount}` : '—',
      debt: amountCents > 0 ? `-${amount}` : '—',
      tone: 'repayment',
      label: 'Cash out · debt down',
      description: 'This records money paid back to the lender. It reduces Store cash and reduces the amount still owed.',
    }
  }

  return {
    cash: amountCents > 0 ? `+${amount}` : '—',
    debt: amountCents > 0 ? `+${amount}` : '—',
    tone: 'received',
    label: 'Cash in · debt up',
    description: 'This records money injected into the Store. It increases Store cash visibility and increases the amount owed.',
  }
}

export default function AdminStoreFundingForm({
  action,
  returnQueryString,
  today,
  fundingTypes,
  paymentMethods,
}: Props) {
  const [fundingDate, setFundingDate] = useState(today)
  const [type, setType] = useState('loan_received')
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [title, setTitle] = useState('')
  const [sourceName, setSourceName] = useState('')
  const [note, setNote] = useState('')
  const [optionalOpen, setOptionalOpen] = useState(false)

  const amountCents = useMemo(() => {
    const cents = parsePriceToCents(normalizeDecimalInput(amount))
    return Number.isFinite(cents) ? Math.max(0, cents) : 0
  }, [amount])

  const hasAmount = amountCents > 0
  const typePreview = labelFromOptions(fundingTypes, type, type || '—')
  const paymentPreview = labelFromOptions(paymentMethods, paymentMethod, paymentMethod || '—')
  const impact = impactDetails(type, amountCents)
  const isRepayment = type === 'loan_repayment'

  function setSuggestedTitle(nextType: string) {
    if (title.trim()) return
    setTitle(nextType === 'loan_repayment' ? 'Loan repayment' : 'Loan received')
  }

  return (
    <CardLike>
      <div className="border-b border-[hsl(var(--border))] px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-black">Quick store funding</h2>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">
              Record Store loans and repayments with a clear cash/debt impact before saving.
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
                  <div className="text-sm font-semibold text-black">Essential funding details</div>
                  <div className="text-xs text-[hsl(var(--muted))]">Date, funding type, amount, payment method, title, and lender/source.</div>
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
                    name="funding_date"
                    value={fundingDate}
                    onChange={(event) => setFundingDate(event.target.value)}
                    className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Funding type</span>
                  <select
                    name="type"
                    value={type}
                    onChange={(event) => {
                      setType(event.target.value)
                      setSuggestedTitle(event.target.value)
                    }}
                    required
                    className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {fundingTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Amount</span>
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
                    placeholder={isRepayment ? 'Example: Repayment to partner' : 'Example: Loan from partner'}
                    required
                    className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none placeholder:text-[hsl(var(--muted))] focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>

                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-sm font-medium">Source / lender</span>
                  <input
                    name="source_name"
                    value={sourceName}
                    onChange={(event) => setSourceName(event.target.value)}
                    placeholder="Optional lender or funding source"
                    className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm outline-none placeholder:text-[hsl(var(--muted))] focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>
              </div>
            </div>

            <div className="rounded-3xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
              <button
                type="button"
                onClick={() => setOptionalOpen((open) => !open)}
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                <span>
                  <span className="block text-sm font-semibold text-black">Optional funding details</span>
                  <span className="block text-xs text-[hsl(var(--muted))]">Add an internal note or upload proof. JPG, PNG, WEBP, or PDF up to 8MB.</span>
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
                    <span className="mb-1 block text-sm font-medium">Proof / attachment</span>
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
              <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted))]">Funding preview</div>
              <div className="mt-2 text-2xl font-semibold text-black">{hasAmount ? formatMoney(amountCents) : '—'}</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">{typePreview} · {paymentPreview}</div>

              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-[hsl(var(--muted))]">Date</dt>
                  <dd className="text-right font-medium text-black">{fundingDate || '—'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[hsl(var(--muted))]">Title</dt>
                  <dd className="max-w-[13rem] truncate text-right font-medium text-black">{shortValue(title, 'Required')}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[hsl(var(--muted))]">Source / lender</dt>
                  <dd className="max-w-[13rem] truncate text-right font-medium text-black">{shortValue(sourceName)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[hsl(var(--muted))]">Proof</dt>
                  <dd className="text-right font-medium text-black">Optional</dd>
                </div>
              </dl>
            </div>

            <div className={`rounded-3xl border p-4 text-sm ${isRepayment ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
              <div className="font-semibold">Cash / debt impact</div>
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <div className="rounded-2xl bg-white/70 p-3">
                  <div className="font-medium opacity-80">Cash impact</div>
                  <div className="mt-1 text-base font-semibold">{impact.cash}</div>
                </div>
                <div className="rounded-2xl bg-white/70 p-3">
                  <div className="font-medium opacity-80">Debt impact</div>
                  <div className="mt-1 text-base font-semibold">{impact.debt}</div>
                </div>
              </div>
              <p className="mt-3 font-medium">{impact.label}</p>
              <p className="mt-1 text-xs">{impact.description}</p>
            </div>

            <div className="rounded-3xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
              <div className="font-semibold">Accounting safety</div>
              <p className="mt-1">
                This creates one Store funding entry only. It does not create a sale, expense, stock movement, supplier order action, or payment reconciliation validation.
              </p>
            </div>
          </aside>
        </div>

        <div className="space-y-2 border-t border-[hsl(var(--border))] pt-4">
          <ConfirmSubmitButton
            confirmTitle="Confirm store funding"
            confirmDescription="Please review this Store funding entry before saving. Funding affects Store cash/debt visibility, not Store revenue."
            confirmButtonLabel="Confirm & save funding"
            pendingLabel="Saving…"
            staticItems={[
              { label: 'Cash impact', value: impact.cash },
              { label: 'Debt impact', value: impact.debt },
              { label: 'Meaning', value: impact.label },
              { label: 'No linked actions', value: 'No sales, expenses, stock, supplier orders, or reconciliation changes' },
            ]}
            fieldItems={[
              { label: 'Date', name: 'funding_date', kind: 'date' },
              { label: 'Type', name: 'type', kind: 'method' },
              { label: 'Title', name: 'title', emptyValue: 'Required' },
              { label: 'Amount', name: 'amount', kind: 'egp' },
              { label: 'Payment', name: 'payment_method', kind: 'method' },
              { label: 'Source / lender', name: 'source_name', emptyValue: '—' },
              { label: 'Note', name: 'note', emptyValue: '—', maxLength: 90 },
              { label: 'Attachment', name: 'attachment', kind: 'file', emptyValue: 'No' },
            ]}
          >
            Review & save funding
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
