import Link from 'next/link'

export default function PaymentsReconciliationLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6 sm:pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white px-4 py-3">
          <div>
            <div className="text-sm font-semibold">Payments Reconciliation</div>
            <div className="text-xs text-[hsl(var(--muted))]">
              Reliable baseline from 01/08/2026
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              prefetch={false}
              href="/admin/payments/reconciliation"
              className="inline-flex items-center rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm font-medium hover:bg-black/[0.03]"
            >
              Reconciliation
            </Link>
            <Link
              prefetch={false}
              href="/admin/payments/reconciliation/evidence"
              className="inline-flex items-center rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm font-medium hover:bg-black/[0.03]"
            >
              Evidence / Proof
            </Link>
            <Link
              prefetch={false}
              href="/admin/payments/reconciliation/bank-matching"
              className="inline-flex items-center rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm font-medium hover:bg-black/[0.03]"
            >
              Bank Matching
            </Link>
          </div>
        </div>
      </div>

      {children}
    </>
  )
}
