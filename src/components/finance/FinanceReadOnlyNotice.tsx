type FinanceReadOnlyNoticeProps = {
  visible: boolean
  detail?: string
}

export default function FinanceReadOnlyNotice({
  visible,
  detail = 'You can review, filter and download available records. Financial changes are reserved for Super Admin.',
}: FinanceReadOnlyNoticeProps) {
  if (!visible) return null

  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950 shadow-soft">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Financial review</span>
        <span className="inline-flex rounded-full border border-sky-300 bg-white px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-sky-800">
          Read only
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-sky-900">{detail}</p>
    </div>
  )
}
