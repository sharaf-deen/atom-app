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
  benefits?: string[] | null
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

function normalizeBenefits(v: any): string[] {
  if (!Array.isArray(v)) return []

  const out: string[] = []
  for (const raw of v) {
    const text = String(raw ?? '')
      .replace(/^[-•*]\s*/, '')
      .trim()
      .slice(0, 120)

    if (!text) continue
    if (out.includes(text)) continue
    out.push(text)
    if (out.length >= 8) break
  }

  return out
}

function benefitsToText(v: any) {
  return normalizeBenefits(v).join('\n')
}

function parseBenefitsText(v: string) {
  return normalizeBenefits(v.split('\n'))
}

function BenefitsEditor({
  value,
  onChange,
}: {
  value: string[] | null | undefined
  onChange: (next: string[]) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-[hsl(var(--muted))]">Benefits / advantages</span>
      <textarea
        value={benefitsToText(value)}
        onChange={(e) => onChange(parseBenefitsText(e.target.value))}
        rows={3}
        placeholder="One benefit per line"
        className="w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3.5 py-2.5 text-sm text-black placeholder:text-[hsl(var(--muted))] shadow-soft outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--bg))]"
      />
      <span className="mt-1 block text-xs text-[hsl(var(--muted))]">Max 8 lines. Keep each benefit short.</span>
    </label>
  )
}

function BenefitsDisplay({ benefits }: { benefits: string[] | null | undefined }) {
  const list = normalizeBenefits(benefits)
  if (list.length === 0) return null

  return (
    <ul className="mt-2 space-y-1 text-xs text-[hsl(var(--muted))]">
      {list.map((benefit) => (
        <li key={benefit} className="flex gap-1.5">
          <span aria-hidden="true">•</span>
          <span>{benefit}</span>
        </li>
      ))}
    </ul>
  )
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
    benefits: [],
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
    setAdding(false)
    setEditingId(id)
    setDraft({ ...it, benefits: normalizeBenefits(it.benefits) })
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
        benefits: normalizeBenefits(draft.benefits),
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
        benefits: normalizeBenefits(newItem.benefits),
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
        benefits: [],
      })
      router.refresh()
    } catch (e: any) {
      setErr(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  async function deleteOne(id: string, name: string) {
    if (!canEdit) return
    const confirmed = window.confirm(`Delete package "${name}"? This will remove it from the price list.`)
    if (!confirmed) return

    setSaving(true)
    setErr('')
    try {
      const r = await fetch('/api/packages-pricing/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const j: any = await safeJson(r)
      if (!r.ok || !j?.ok) {
        setErr(j?.details || j?.error || 'Failed to delete')
        return
      }

      if (editingId === id) {
        setEditingId(null)
        setDraft({})
      }
      router.refresh()
    } catch (e: any) {
      setErr(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  const addForm = (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg))] p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="text-xs text-[hsl(var(--muted))]">Name</div>
          <Input value={newItem.name} onChange={(e) => setNewItem((p) => ({ ...p, name: e.target.value }))} />
        </div>

        <div>
          <div className="text-xs text-[hsl(var(--muted))]">Type</div>
          <Select value={newItem.type} onChange={(e) => setNewItem((p) => ({ ...p, type: e.target.value as any }))}>
            <option value="membership">membership</option>
            <option value="private">private</option>
          </Select>
        </div>

        <div>
          <div className="text-xs text-[hsl(var(--muted))]">Unit</div>
          <Select value={newItem.unit} onChange={(e) => setNewItem((p) => ({ ...p, unit: e.target.value as any }))}>
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

        <div className="sm:col-span-2">
          <BenefitsEditor value={newItem.benefits} onChange={(benefits) => setNewItem((p) => ({ ...p, benefits }))} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={createOne} loading={saving} loadingText="Saving…">
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
  )

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
                <div className="mt-2">{addForm}</div>
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
                const row = isEditing ? (draft as PackageItem) : it

                return (
                  <tr key={it.id} className="odd:bg-[hsl(var(--card))] even:bg-[hsl(var(--bg))] align-top">
                    <td className="min-w-[220px] border-t border-[hsl(var(--border))] p-3">
                      {isEditing ? (
                        <div className="space-y-3">
                          <div>
                            <div className="text-xs text-[hsl(var(--muted))]">Name</div>
                            <Input value={String(row.name ?? '')} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))} />
                          </div>
                          <BenefitsEditor value={row.benefits} onChange={(benefits) => setDraft((p) => ({ ...p, benefits }))} />
                        </div>
                      ) : (
                        <div>
                          <div className="font-medium">{it.name}</div>
                          <BenefitsDisplay benefits={it.benefits} />
                        </div>
                      )}
                    </td>

                    <td className="border-t border-[hsl(var(--border))] p-3">
                      {isEditing ? (
                        <Select value={String(row.type ?? 'membership')} onChange={(e) => setDraft((p) => ({ ...p, type: e.target.value as any }))}>
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
                        <Select value={String(row.unit ?? 'month')} onChange={(e) => setDraft((p) => ({ ...p, unit: e.target.value as any }))}>
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
                        <Badge className="border-black bg-black text-white">Active</Badge>
                      ) : (
                        <Badge>Inactive</Badge>
                      )}
                    </td>

                    <td className="border-t border-[hsl(var(--border))] p-3">
                      {canEdit ? (
                        isEditing ? (
                          <div className="flex flex-col gap-2">
                            <Button onClick={saveEdit} loading={saving} loadingText="Saving…">
                              Save
                            </Button>
                            <Button variant="outline" onClick={cancelEdit} disabled={saving}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <Button variant="outline" onClick={() => startEdit(it.id)} disabled={saving}>
                              Edit
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => deleteOne(it.id, it.name)}
                              disabled={saving}
                              className="border-red-200 text-red-700 hover:bg-red-50"
                            >
                              Delete
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

          {canEdit ? (
            <div className="border-t border-[hsl(var(--border))] p-3">
              {!adding ? (
                <Button variant="outline" onClick={() => setAdding(true)}>
                  Add a package
                </Button>
              ) : (
                addForm
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
