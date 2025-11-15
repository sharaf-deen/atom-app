import * as React from 'react'
export function Table({ columns, rows, keyField }: { columns: { key: string; header: string }[]; rows: Record<string, any>[]; keyField: string }) {
  return (
    <>
      <div className="hidden md:block rounded-2xl border border-[hsl(var(--border))] bg-white shadow-soft overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[hsl(var(--bg))] text-left">
            <tr>
              {columns.map(col => (
                <th key={col.key} className="px-4 py-3 border-b border-[hsl(var(--border))] font-medium">{col.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row[keyField]} className="odd:bg-white even:bg-[hsl(var(--bg))]">
                {columns.map(col => (
                  <td key={col.key} className="px-4 py-3 border-t border-[hsl(var(--border))]">{row[col.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="md:hidden space-y-3">
        {rows.map(row => (
          <div key={row[keyField]} className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 shadow-soft">
            {columns.map(col => (
              <div key={col.key} className="flex justify-between py-1 text-sm">
                <span className="text-[hsl(var(--muted))]">{col.header}</span>
                <span className="font-medium">{row[col.key]}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}
