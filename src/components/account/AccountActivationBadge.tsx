import {
  accountActivationLabel,
  accountActivationTone,
  type AccountActivationStatus,
} from '@/lib/accountActivation'

export default function AccountActivationBadge({
  status,
  compact = false,
}: {
  status: AccountActivationStatus
  compact?: boolean
}) {
  const tone = accountActivationTone(status)
  const cls =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : tone === 'danger'
          ? 'border-rose-200 bg-rose-50 text-rose-700'
          : 'border-slate-200 bg-slate-50 text-slate-700'

  return (
    <span
      className={[
        'inline-flex items-center rounded-full border font-semibold',
        compact ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs',
        cls,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {accountActivationLabel(status)}
    </span>
  )
}
