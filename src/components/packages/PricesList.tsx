'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Badge from '@/components/ui/Badge'

export type PackageItem = {
  id: string
  name: string
  type: 'membership' | 'private'
  unit: 'month' | 'session'
  qty: number
  price_egp: number
  is_active: boolean
}

type Props = {
  items: PackageItem[]
  canEdit: boolean
}

async function safeJson(r: Response) {
  try {
    return await r.json()
  } catch {
    return {}
  }
}

function toInt(v: any, def: number) {
  const n = Number(v)
  if (!Number.isFinite(n)) return def
  return Math.floor(n)
}

export default function PricesList({ items, canEdit }: Props) {
  const router = useRouter()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string>('')

  const [adding, setAdding] = useState(false)
  const [newItem, setNewItem] = useState<Omit<PackageItem, 'id'>>({
    name: 'New package',
    type: 'membership',
    unit: 'month',
    qty: 1,
    price_egp: 0,
    is_active: true,
  })

  const byId = useMemo(() => {
    const m = new Map<string, PackageItem>()
    for (const it of items) m.set(it.id, it)
    return m
  }, [items])

  const [draft, setDraft] = useState<Partial<PackageItem>>({})

  function startEdit(id: string) {
    const it = byId.get(id)
    if (!it) return
    setErr('')
    setEditingId(id)
    setDraft({ ...it })
  }

  function cancelEdit() {
    setEditingId(null)
    setDraft({})
    setErr('')
  }

  async function saveEdit() {
    if (!editingId) return
    setSaving(true)
    setErr('')
    try {
      const patch = {
        name: String(draft.name ?? ''),
        type: draft.type,
        unit: draft.unit,
        qty: toInt(draft.qty, 1),
        price_egp: toInt(draft.price_egp, 0),
        is_active: !!draft.is_active,
      }

      const r = await fetch('/api/packages-pricing/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingId, patch }),
      })
      const j: any = await safeJson(r)
      if (!r.ok || !j?.ok) {
        setErr(j?.details || j?.error || 'Failed to save')
        return
      }

      setEditingId(null)
      setDraft({})
      router.refresh()
    } catch (e: any) {
      setErr(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  async function createOne() {
    if (!canEdit) return
    setSaving(true)
    setErr('')
    try {
      const payload = {
        name: String(newItem.name ?? '').trim(),
        type: newItem.type,
        unit: newItem.unit,
        qty: toInt(newItem.qty, 1),
        price_egp: toInt(newItem.price_egp, 0),
        is_active: !!newItem.is_active,
      }

      if (!payload.name) {
        setErr('Name is required')
        return
      }

      const r = await fetch('/api/packages-pricing/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: payload }),
      })
      const j: any = await safeJson(r)
      if (!r.ok || !j?.ok) {
        setErr(j?.details || j?.error || 'Failed to create')
        return
      }

      setAdding(false)
      setNewItem({
        name: 'New package',
        type: 'membership',
        unit: 'month',
        qty: 1,
        price_egp: 0,
        is_active: true,
      })
      router.refresh()
    } catch (e: any) {
      setErr(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {err ? (
        <div className="mb-3 rounded-2xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
          <div className="text-sm text-[hsl(var(--muted))]">No packages.</div>

          {canEdit ? (
            <div className="mt-3">
              {!adding ? (
                <Button variant="outline" onClick={() => setAdding(true)}>
                  Add a package
                </Button>
              ) : (
                <div className="mt-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-xs text-[hsl(var(--muted))]">Name</div>
                      <Input value={newItem.name} onChange={(e) => setNewItem((p) => ({ ...p, name: e.target.value }))} />
                    </div>

                    <div>
                      <div className="text-xs text-[hsl(var(--muted))]">Type</div>
                      <Select
                        value={newItem.type}
                        onChange={(e) => setNewItem((p) => ({ ...p, type: e.target.value as any }))}
                      >
                        <option value="membership">membership</option>
                        <option value="private">private</option>
                      </Select>
                    </div>

                    <div>
                      <div className="text-xs text-[hsl(var(--muted))]">Unit</div>
                      <Select
                        value={newItem.unit}
                        onChange={(e) => setNewItem((p) => ({ ...p, unit: e.target.value as any }))}
                      >
                        <option value="month">month</option>
                        <option value="session">session</option>
                      </Select>
                    </div>

                    <div>
                      <div className="text-xs text-[hsl(var(--muted))]">Qty</div>
                      <Input
                        type="number"
                        value={String(newItem.qty)}
                        onChange={(e) => setNewItem((p) => ({ ...p, qty: toInt(e.target.value, 1) }))}
                      />
                    </div>

                    <div>
                      <div className="text-xs text-[hsl(var(--muted))]">Price (EGP)</div>
                      <Input
                        type="number"
                        value={String(newItem.price_egp)}
                        onChange={(e) => setNewItem((p) => ({ ...p, price_egp: toInt(e.target.value, 0) }))}
                      />
                    </div>

                    <div className="flex items-end">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={!!newItem.is_active}
                          onChange={(e) => setNewItem((p) => ({ ...p, is_active: e.target.checked }))}
                        />
                        Active
                      </label>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <Button onClick={createOne} disabled={saving}>
                      Save
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setAdding(false)
                        setErr('')
                      }}
                      disabled={saving}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-soft">
          <table className="min-w-full text-sm">
            <thead className="bg-[hsl(var(--bg))] text-left">
              <tr>
                <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Name</th>
                <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Type</th>
                <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Qty</th>
                <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Unit</th>
                <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Price</th>
                <th className="border-b border-[hsl(var(--border))] p-3 font-medium">Status</th>
                <th className="border-b border-[hsl(var(--border))] p-3" />
              </tr>
            </thead>

            <tbody>
              {items.map((it) => {
                const isEditing = editingId === it.id
                const row = isEditing ? (draft as any) : it

                return (
                  <tr key={it.id} className="odd:bg-[hsl(var(--card))] even:bg-[hsl(var(--bg))] align-top">
                    <td className="border-t border-[hsl(var(--border))] p-3">
                      {isEditing ? (
                        <Input
                          value={String(row.name ?? '')}
                          onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                        />
                      ) : (
                        <div className="font-medium">{it.name}</div>
                      )}
                    </td>

                    <td className="border-t border-[hsl(var(--border))] p-3">
                      {isEditing ? (
                        <Select
                          value={String(row.type ?? 'membership')}
                          onChange={(e) => setDraft((p) => ({ ...p, type: e.target.value as any }))}
                        >
                          <option value="membership">membership</option>
                          <option value="private">private</option>
                        </Select>
                      ) : (
                        <Badge>{it.type}</Badge>
                      )}
                    </td>

                    <td className="border-t border-[hsl(var(--border))] p-3">
                      {isEditing ? (
                        <Input
                          type="number"
                          value={String(row.qty ?? 1)}
                          onChange={(e) => setDraft((p) => ({ ...p, qty: toInt(e.target.value, 1) }))}
                        />
                      ) : (
                        it.qty
                      )}
                    </td>

                    <td className="border-t border-[hsl(var(--border))] p-3">
                      {isEditing ? (
                        <Select
                          value={String(row.unit ?? 'month')}
                          onChange={(e) => setDraft((p) => ({ ...p, unit: e.target.value as any }))}
                        >
                          <option value="month">month</option>
                          <option value="session">session</option>
                        </Select>
                      ) : (
                        it.unit
                      )}
                    </td>

                    <td className="border-t border-[hsl(var(--border))] p-3">
                      {isEditing ? (
                        <Input
                          type="number"
                          value={String(row.price_egp ?? 0)}
                          onChange={(e) => setDraft((p) => ({ ...p, price_egp: toInt(e.target.value, 0) }))}
                        />
                      ) : (
                        `${it.price_egp} EGP`
                      )}
                    </td>

                    <td className="border-t border-[hsl(var(--border))] p-3">
                      {isEditing ? (
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={!!row.is_active}
                            onChange={(e) => setDraft((p) => ({ ...p, is_active: e.target.checked }))}
                          />
                          Active
                        </label>
                      ) : it.is_active ? (
                        <Badge className="bg-black text-white border-black">Active</Badge>
                      ) : (
                        <Badge>Inactive</Badge>
                      )}
                    </td>

                    <td className="border-t border-[hsl(var(--border))] p-3">
                      {canEdit ? (
                        isEditing ? (
                          <div className="flex flex-col gap-2">
                            <Button onClick={saveEdit} disabled={saving}>
                              Save
                            </Button>
                            <Button variant="outline" onClick={cancelEdit} disabled={saving}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button variant="outline" onClick={() => startEdit(it.id)}>
                            Edit
                          </Button>
                        )
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {canEdit ? (
            <div className="border-t border-[hsl(var(--border))] p-3">
              {!adding ? (
                <Button variant="outline" onClick={() => setAdding(true)}>
                  Add a package
                </Button>
              ) : (
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-xs text-[hsl(var(--muted))]">Name</div>
                      <Input value={newItem.name} onChange={(e) => setNewItem((p) => ({ ...p, name: e.target.value }))} />
                    </div>

                    <div>
                      <div className="text-xs text-[hsl(var(--muted))]">Type</div>
                      <Select
                        value={newItem.type}
                        onChange={(e) => setNewItem((p) => ({ ...p, type: e.target.value as any }))}
                      >
                        <option value="membership">membership</option>
                        <option value="private">private</option>
                      </Select>
                    </div>

                    <div>
                      <div className="text-xs text-[hsl(var(--muted))]">Unit</div>
                      <Select
                        value={newItem.unit}
                        onChange={(e) => setNewItem((p) => ({ ...p, unit: e.target.value as any }))}
                      >
                        <option value="month">month</option>
                        <option value="session">session</option>
                      </Select>
                    </div>

                    <div>
                      <div className="text-xs text-[hsl(var(--muted))]">Qty</div>
                      <Input
                        type="number"
                        value={String(newItem.qty)}
                        onChange={(e) => setNewItem((p) => ({ ...p, qty: toInt(e.target.value, 1) }))}
                      />
                    </div>

                    <div>
                      <div className="text-xs text-[hsl(var(--muted))]">Price (EGP)</div>
                      <Input
                        type="number"
                        value={String(newItem.price_egp)}
                        onChange={(e) => setNewItem((p) => ({ ...p, price_egp: toInt(e.target.value, 0) }))}
                      />
                    </div>

                    <div className="flex items-end">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={!!newItem.is_active}
                          onChange={(e) => setNewItem((p) => ({ ...p, is_active: e.target.checked }))}
                        />
                        Active
                      </label>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <Button onClick={createOne} disabled={saving}>
                      Save
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setAdding(false)
                        setErr('')
                      }}
                      disabled={saving}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
