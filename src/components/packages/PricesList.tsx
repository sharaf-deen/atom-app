'use client'

import { useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Badge from '@/components/ui/Badge'

export type PriceItem = {
  id: string
  title: string
  price_egp: number
  sort_order: number | null
  is_active: boolean | null
}

type Props = {
  /** Server-provided items (recommended). If omitted, component will render empty list. */
  items?: PriceItem[]
  /** Only super_admin should pass true */
  canEdit?: boolean
}

function safeNumber(v: any, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

async function safeJson(r: Response) {
  try {
    return await r.json()
  } catch {
    return {}
  }
}

export default function PricesList({ items = [], canEdit = false }: Props) {
  const [rows, setRows] = useState<PriceItem[]>(Array.isArray(items) ? items : [])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<PriceItem> | null>(null)
  const [saving, setSaving] = useState(false)

  const sorted = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const ao = a.sort_order ?? 999999
      const bo = b.sort_order ?? 999999
      if (ao !== bo) return ao - bo
      return String(a.title || '').localeCompare(String(b.title || ''))
    })
    return copy
  }, [rows])

  function startEdit(r: PriceItem) {
    setEditingId(r.id)
    setDraft({ ...r })
  }

  function cancelEdit() {
    setEditingId(null)
    setDraft(null)
  }

  async function saveEdit() {
    if (!canEdit || !editingId || !draft) return

    const patch: any = {}
    if (draft.title !== undefined) patch.title = String(draft.title || '').trim()
    if (draft.price_egp !== undefined) patch.price_egp = Math.max(0, Math.floor(safeNumber(draft.price_egp, 0)))
    if (draft.sort_order !== undefined) patch.sort_order = Math.floor(safeNumber(draft.sort_order, 0))
    if (draft.is_active !== undefined) patch.is_active = !!draft.is_active

    setSaving(true)
    try {
      const r = await fetch('/api/packages-pricing/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingId, patch }),
      })
      const j: any = await safeJson(r)
      if (!r.ok || !j?.ok) {
        alert(j?.details || j?.error || 'Failed to save')
        return
      }

      const nextItem = j.item as PriceItem
      setRows((prev) => prev.map((x) => (x.id === nextItem.id ? nextItem : x)))
      cancelEdit()
    } finally {
      setSaving(false)
    }
  }

  if (!sorted.length) {
    return <div className="text-sm text-[hsl(var(--muted))]">No packages.</div>
  }

  return (
    <div className="space-y-3">
      <div className="hidden overflow-x-auto rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-soft md:block">
        <table className="min-w-full text-sm">
          <thead className="bg-[hsl(var(--bg))] text-left">
            <tr>
              <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Package</th>
              <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Price</th>
              <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Order</th>
              <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Status</th>
              <th className="border-b border-[hsl(var(--border))] p-3" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const isEditing = canEdit && editingId === r.id
              return (
                <tr key={r.id} className="odd:bg-[hsl(var(--card))] even:bg-[hsl(var(--bg))] align-top">
                  <td className="border-t border-[hsl(var(--border))] p-3 font-medium">
                    {isEditing ? (
                      <Input
                        value={String(draft?.title ?? '')}
                        onChange={(e) => setDraft((d) => ({ ...(d || {}), title: e.target.value }))}
                        className="w-full"
                      />
                    ) : (
                      r.title
                    )}
                  </td>
                  <td className="border-t border-[hsl(var(--border))] p-3">
                    {isEditing ? (
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={String(draft?.price_egp ?? 0)}
                        onChange={(e) => setDraft((d) => ({ ...(d || {}), price_egp: e.target.value as any }))}
                        className="w-32"
                      />
                    ) : (
                      <span>{safeNumber(r.price_egp, 0).toLocaleString()} EGP</span>
                    )}
                  </td>
                  <td className="border-t border-[hsl(var(--border))] p-3">
                    {isEditing ? (
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={String(draft?.sort_order ?? 0)}
                        onChange={(e) => setDraft((d) => ({ ...(d || {}), sort_order: e.target.value as any }))}
                        className="w-24"
                      />
                    ) : (
                      <span className="text-[hsl(var(--muted))]">{r.sort_order ?? '—'}</span>
                    )}
                  </td>
                  <td className="border-t border-[hsl(var(--border))] p-3">
                    {isEditing ? (
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={!!draft?.is_active}
                          onChange={(e) => setDraft((d) => ({ ...(d || {}), is_active: e.target.checked }))}
                        />
                        Active
                      </label>
                    ) : r.is_active ? (
                      <Badge className="bg-black text-white border-black">Active</Badge>
                    ) : (
                      <Badge>Inactive</Badge>
                    )}
                  </td>
                  <td className="border-t border-[hsl(var(--border))] p-3">
                    {canEdit ? (
                      isEditing ? (
                        <div className="flex items-center justify-end gap-2">
                          <Button onClick={saveEdit} disabled={saving} className="px-3 py-2">
                            Save
                          </Button>
                          <Button variant="outline" onClick={cancelEdit} disabled={saving} className="px-3 py-2">
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end">
                          <Button variant="outline" onClick={() => startEdit(r)} className="px-3 py-2">
                            Edit
                          </Button>
                        </div>
                      )
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <div className="md:hidden space-y-3">
        {sorted.map((r) => {
          const isEditing = canEdit && editingId === r.id
          return (
            <div key={r.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="text-sm font-semibold">
                    {isEditing ? (
                      <Input
                        value={String(draft?.title ?? '')}
                        onChange={(e) => setDraft((d) => ({ ...(d || {}), title: e.target.value }))}
                      />
                    ) : (
                      r.title
                    )}
                  </div>
                  <div className="mt-1 text-sm text-[hsl(var(--muted))]">
                    {isEditing ? (
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={String(draft?.price_egp ?? 0)}
                        onChange={(e) => setDraft((d) => ({ ...(d || {}), price_egp: e.target.value as any }))}
                      />
                    ) : (
                      `${safeNumber(r.price_egp, 0).toLocaleString()} EGP`
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    {isEditing ? (
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={!!draft?.is_active}
                          onChange={(e) => setDraft((d) => ({ ...(d || {}), is_active: e.target.checked }))}
                        />
                        Active
                      </label>
                    ) : r.is_active ? (
                      <Badge className="bg-black text-white border-black">Active</Badge>
                    ) : (
                      <Badge>Inactive</Badge>
                    )}
                    <span className="text-xs text-[hsl(var(--muted))]">Order: {r.sort_order ?? '—'}</span>
                  </div>
                </div>
                {canEdit ? (
                  isEditing ? (
                    <div className="flex flex-col gap-2">
                      <Button onClick={saveEdit} disabled={saving} className="px-3 py-2">
                        Save
                      </Button>
                      <Button variant="outline" onClick={cancelEdit} disabled={saving} className="px-3 py-2">
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button variant="outline" onClick={() => startEdit(r)} className="px-3 py-2">
                      Edit
                    </Button>
                  )
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
