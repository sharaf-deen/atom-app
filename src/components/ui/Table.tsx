import * as React from 'react'

type Column = {
  key: string
  header: string
  /** Optional: add classes for header cell */
  thClassName?: string
  /** Optional: add classes for body cell */
  tdClassName?: string
  /** Optional: hide a column on small screens */
  hideOnMobile?: boolean
}

type Props = {
  columns: Column[]
  rows: Record<string, any>[]
  keyField: string
  /**
   * If true, use the legacy mobile card layout.
   * Default is false because the app is mobile-first and we want sticky headers everywhere.
   */
  mobileCards?: boolean
  /**
   * Sticky offset below the app nav (h-12).
   * If you ever change AppNav height, adjust here.
   */
  stickyTopClassName?: string
}

export function Table({
  columns,
  rows,
  keyField,
  mobileCards = false,
  stickyTopClassName = 'top-12',
}: Props) {
  const visibleCols = React.useMemo(() => {
    if (!mobileCards) return columns
    // In card mode we still display all columns (label/value pairs)
    return columns
  }, [columns, mobileCards])

  if (mobileCards) {
    // Compact card layout (legacy)
    return (
      <div className="space-y-3">
        {rows.map((row) => (
          <div
            key={row[keyField]}
            className="rounded-2xl border border-[hsl(var(--border))] bg-white dark:bg-black p-3 shadow-soft"
          >
            {visibleCols.map((col) => (
              <div key={col.key} className="flex justify-between gap-3 py-1 text-sm">
                <span className="text-[12px] text-[hsl(var(--muted))]">{col.header}</span>
                <span className="min-w-0 text-right font-medium truncate">{row[col.key]}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }

  // Mobile-first table (compact + sticky header on all breakpoints)
  // - Sticky header sits below the sticky AppNav (h-12).
  // - Horizontal scroll is enabled for narrow screens.
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white dark:bg-black shadow-soft overflow-hidden">
      <div className="max-w-full overflow-x-auto">
        <table className="w-full text-[13px] leading-5">
          <thead className="text-left">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={[
                    'sticky',
                    stickyTopClassName,
                    'z-10',
                    'bg-white dark:bg-black',
                    'border-b border-[hsl(var(--border))]',
                    'px-3 py-2',
                    'font-semibold',
                    'whitespace-nowrap',
                    col.hideOnMobile ? 'hidden sm:table-cell' : '',
                    col.thClassName ?? '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr
                key={row[keyField]}
                className="odd:bg-white even:bg-[hsl(var(--bg))] dark:odd:bg-black dark:even:bg-white/[0.04]"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={[
                      'px-3 py-2',
                      'border-t border-[hsl(var(--border))]',
                      'align-top',
                      'whitespace-nowrap',
                      col.hideOnMobile ? 'hidden sm:table-cell' : '',
                      col.tdClassName ?? '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <div className="max-w-[70vw] sm:max-w-none truncate">{row[col.key]}</div>
                  </td>
                ))}
              </tr>
            ))}

            {!rows.length ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-6 text-center text-sm text-[hsl(var(--muted))]"
                >
                  No results
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
