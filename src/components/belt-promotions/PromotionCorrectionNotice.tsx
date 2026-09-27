'use client'

import { useSearchParams } from 'next/navigation'

const ERROR_LABELS: Record<string, string> = {
  forbidden: 'Only Head Coach or Super Admin can correct a promotion.',
  invalid: 'The correction request was invalid.',
  not_found: 'The promotion could not be found.',
  already_corrected: 'This promotion has already been corrected.',
  later_promotion: 'A later promotion exists for this member. Correct the latest promotion first.',
  state_changed: 'The member’s current grade no longer matches this promotion, so it was not changed.',
  failed: 'The correction could not be completed. No correction was recorded.',
}

export default function PromotionCorrectionNotice() {
  const searchParams = useSearchParams()
  const corrected = searchParams.get('correction')
  const error = searchParams.get('correction_error')

  if (corrected === 'ok') {
    return (
      <div className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        Promotion correction saved. The member’s current grade was restored and the correction remains in the audit log.
      </div>
    )
  }

  if (error) {
    return (
      <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
        {ERROR_LABELS[error] ?? ERROR_LABELS.failed}
      </div>
    )
  }

  return null
}
