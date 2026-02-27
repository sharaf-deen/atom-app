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
   * Sticky offset below the app nav (h-12).
   * If you ever change AppNav height, adjust here.
   */
  stickyTopClassName?: string
  /**
   * Force table even on mobile (NOT recommended). Default false.
   * We keep this only for rare pages that truly need a table on mobile.
   */
  forceTableOnMobile?: boolean
}

function isActionCol(col: Column) {
  const k = (col.key ?? '').toLowerCase()
  const h = (col.header ?? '').trim()
  if (!h) return true
  return k === 'actions' || k === 'action' || k === 'open' || k === 'more'
}

function visibleColsMobile(columns: Column[]) {
  return columns.filter((c) => !c.hideOnMobile)
}

export function Table({
  columns,
  rows,
  keyField,
  stickyTopClassName = 'top-12',
  forceTableOnMobile = false,
}: Props) {
  const mobileCols = React.useMemo(() => visibleColsMobile(columns), [columns])

  // Always use cards on mobile (no horizontal scroll).
  if (!forceTableOnMobile) {
    const infoCols = mobileCols.filter((c) => !isActionCol(c))
    const actionCols = mobileCols.filter((c) => isActionCol(c))

    return (
      <>
        {/* Mobile cards */}
        <div className="space-y-3 sm:hidden">
          {rows.map((row) => {
            const rowKey = row[keyField]
            return (
              <div
                key={rowKey}
                className="rounded-2xl border border-[hsl(var(--border))] bg-white dark:bg-black p-3 shadow-soft"
              >
                {/* Info */}
                <div className="space-y-2">
                  {infoCols.map((col) => (
                    <div key={col.key} className="flex items-start justify-between gap-3">
                      <div className="text-[11px] font-medium text-[hsl(var(--muted))] shrink-0">{col.header}</div>
                      <div className="min-w-0 text-right text-[13px] font-medium break-words whitespace-normal">
                        {row[col.key]}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Actions */}
                {actionCols.length ? (
                  <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-[hsl(var(--border))] pt-3">
                    {actionCols.map((col) => (
                      <React.Fragment key={col.key}>{row[col.key]}</React.Fragment>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}

          {!rows.length ? (
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-white dark:bg-black p-4 text-center text-sm text-[hsl(var(--muted))] shadow-soft">
              No results
            </div>
          ) : null}
        </div>

        {/* Tablet/Desktop table */}
        <div className="hidden sm:block rounded-2xl border border-[hsl(var(--border))] bg-white dark:bg-black shadow-soft overflow-hidden">
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
                        col.tdClassName ?? '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <div className="max-w-[60vw] lg:max-w-none truncate">{row[col.key]}</div>
                    </td>
                  ))}
                </tr>
              ))}

              {!rows.length ? (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-6 text-center text-sm text-[hsl(var(--muted))]">
                    No results
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </>
    )
  }

  // Rare: force table on mobile (may overflow)
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-white dark:bg-black shadow-soft overflow-hidden">
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
              <td colSpan={columns.length} className="px-3 py-6 text-center text-sm text-[hsl(var(--muted))]">
                No results
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}
