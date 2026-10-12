import Link from 'next/link'

const ITEMS = [
  { href: '/admin/payments', step: '1', label: 'Payments' },
  { href: '/admin/payments/reconciliation', step: '2', label: 'Payment validation' },
  { href: '/admin/banking', step: '3', label: 'Bank feed' },
  { href: '/admin/banking/reconciliation', step: '4A', label: 'Income match' },
  { href: '/admin/banking/outflows', step: '4B', label: 'Outflow match' },
  { href: '/admin/banking/cash-position', step: '5', label: 'Cash position' },
] as const

export default function FinanceReconciliationNav({ current }: { current: string }) {
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-3 shadow-soft">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted))]">
        Finance reconciliation flow
      </div>
      <nav className="flex gap-2 overflow-x-auto pb-1">
        {ITEMS.map((item) => {
          const active = current === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                'inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition ' +
                (active
                  ? 'border-black bg-black text-white'
                  : 'border-[hsl(var(--border))] bg-white hover:bg-black/[0.03]')
              }
            >
              <span
                className={
                  'inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold ' +
                  (active ? 'bg-white/15 text-white' : 'bg-[hsl(var(--bg))] text-[hsl(var(--muted))]')
                }
              >
                {item.step}
              </span>
              {item.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
