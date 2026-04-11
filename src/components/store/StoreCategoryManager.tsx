'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import InlineAlert from '@/components/ui/InlineAlert'
import {
  normalizeStoreCategoryKey,
  type StoreProductCategoryRow,
  sortStoreProductCategories,
} from '@/lib/storeCategories'

type StoreCategoryRow = StoreProductCategoryRow

type CategoryFormState = {
  key: string
  label: string
  sort_order: number
  is_active: boolean
}

const EMPTY_FORM: CategoryFormState = {
  key: '',
  label: '',
  sort_order: 0,
  is_active: true,
}

export default function StoreCategoryManager() {
  const router = useRouter()
  const [items, setItems] = useState<StoreCategoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: '' | 'success' | 'error'; msg: string }>({ kind: '', msg: '' })
  const [form, setForm] = useState<CategoryFormState>(EMPTY_FORM)
  const [editingKey, setEditingKey] = useState('')
  const [editForm, setEditForm] = useState<CategoryFormState>(EMPTY_FORM)

  async function load() {
    setLoading(true)
    setStatus((current) => (current.kind === 'error' ? { kind: '', msg: '' } : current))
    try {
      const res = await fetch('/api/store/categories/list?include_inactive=1', {
        cache: 'no-store',
        credentials: 'include',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setItems([])
        setStatus({ kind: 'error', msg: json?.details || json?.error || 'Failed to load categories.' })
        return
      }
      const rows = Array.isArray(json.items) ? (json.items as StoreCategoryRow[]) : []
      setItems(sortStoreProductCategories(rows))
    } catch (e: any) {
      setItems([])
      setStatus({ kind: 'error', msg: e?.message || 'Failed to load categories.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const activeCount = useMemo(() => items.filter((item) => item.is_active).length, [items])

  function resetCreateForm() {
    setForm(EMPTY_FORM)
  }

  function startEdit(item: StoreCategoryRow) {
    setEditingKey(item.key)
    setEditForm({
      key: item.key,
      label: item.label,
      sort_order: Number(item.sort_order || 0),
      is_active: !!item.is_active,
    })
    setStatus({ kind: '', msg: '' })
  }

  function cancelEdit() {
    setEditingKey('')
    setEditForm(EMPTY_FORM)
  }

  async function createCategory(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return

    const key = normalizeStoreCategoryKey(form.key)
    const label = form.label.trim()
    if (!key) {
      setStatus({ kind: 'error', msg: 'Key is required. Use letters, numbers, spaces or dashes.' })
      toast.error('Category key is required')
      return
    }
    if (!label) {
      setStatus({ kind: 'error', msg: 'Label is required.' })
      toast.error('Category label is required')
      return
    }

    setBusy(true)
    setStatus({ kind: '', msg: '' })
    try {
      const res = await fetch('/api/store/categories/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key,
          label,
          sort_order: Number(form.sort_order || 0),
          is_active: !!form.is_active,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        const msg = json?.details || json?.error || 'Create failed.'
        setStatus({ kind: 'error', msg })
        toast.error('Category create failed')
        return
      }
      const nextItems = sortStoreProductCategories([...items, json.item as StoreCategoryRow])
      setItems(nextItems)
      resetCreateForm()
      setStatus({ kind: 'success', msg: 'Category added.' })
      toast.success('Category added')
      router.refresh()
    } catch (e: any) {
      const msg = e?.message || 'Create failed.'
      setStatus({ kind: 'error', msg })
      toast.error('Category create failed')
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit() {
    if (!editingKey || busy) return
    const key = normalizeStoreCategoryKey(editForm.key)
    const label = editForm.label.trim()
    if (!key) {
      setStatus({ kind: 'error', msg: 'Key is required.' })
      toast.error('Category key is required')
      return
    }
    if (!label) {
      setStatus({ kind: 'error', msg: 'Label is required.' })
      toast.error('Category label is required')
      return
    }

    setBusy(true)
    setStatus({ kind: '', msg: '' })
    try {
      const res = await fetch('/api/store/categories/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          old_key: editingKey,
          key,
          label,
          sort_order: Number(editForm.sort_order || 0),
          is_active: !!editForm.is_active,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        const msg = json?.details || json?.error || 'Update failed.'
        setStatus({ kind: 'error', msg })
        toast.error('Category update failed')
        return
      }
      const updated = json.item as StoreCategoryRow
      setItems((current) =>
        sortStoreProductCategories(current.map((item) => (item.key === editingKey ? updated : item)))
      )
      setEditingKey('')
      setEditForm(EMPTY_FORM)
      setStatus({ kind: 'success', msg: 'Category updated.' })
      toast.success('Category updated')
      router.refresh()
    } catch (e: any) {
      const msg = e?.message || 'Update failed.'
      setStatus({ kind: 'error', msg })
      toast.error('Category update failed')
    } finally {
      setBusy(false)
    }
  }

  async function removeCategory(key: string) {
    if (busy) return
    const confirmed = globalThis.confirm('Delete this category? This is blocked while products still use it.')
    if (!confirmed) return

    setBusy(true)
    setStatus({ kind: '', msg: '' })
    try {
      const res = await fetch(`/api/store/categories/delete?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
        cache: 'no-store',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        const msg = json?.details || json?.error || 'Delete failed.'
        setStatus({ kind: 'error', msg })
        toast.error('Category delete failed')
        return
      }
      setItems((current) => current.filter((item) => item.key !== key))
      setStatus({ kind: 'success', msg: 'Category deleted.' })
      toast.success('Category deleted')
      router.refresh()
    } catch (e: any) {
      const msg = e?.message || 'Delete failed.'
      setStatus({ kind: 'error', msg })
      toast.error('Category delete failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Product categories</div>
          <div className="text-xs text-[hsl(var(--muted))]">
            Super admin only. Add, rename, sort, activate or delete categories safely.
          </div>
        </div>
        <div className="rounded-full border px-2.5 py-1 text-[11px] font-medium text-[hsl(var(--muted))]">
          {items.length} total · {activeCount} active
        </div>
      </div>

      {status.msg ? (
        <InlineAlert variant={status.kind === 'error' ? 'error' : 'success'} compact>
          {status.msg}
        </InlineAlert>
      ) : null}

      <form onSubmit={createCategory} className="grid gap-3 rounded-2xl border bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_auto] xl:items-end">
          <Input
            label="Key *"
            value={form.key}
            onChange={(e) => setForm((current) => ({ ...current, key: e.target.value }))}
            placeholder="ex: gi_kids"
            disabled={busy}
          />
          <Input
            label="Label *"
            value={form.label}
            onChange={(e) => setForm((current) => ({ ...current, label: e.target.value }))}
            placeholder="ex: GI Kids"
            disabled={busy}
          />
          <Input
            label="Sort"
            type="number"
            value={form.sort_order}
            onChange={(e) => setForm((current) => ({ ...current, sort_order: Number(e.target.value || 0) }))}
            disabled={busy}
          />
          <label className="flex items-center gap-2 text-sm pb-2">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((current) => ({ ...current, is_active: e.target.checked }))}
              disabled={busy}
            />
            Active
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-[hsl(var(--muted))]">
            The key is the internal value stored on products. Spaces and dashes are normalized safely.
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={resetCreateForm} disabled={busy}>
              Reset
            </Button>
            <Button type="submit" loading={busy} loadingText="Adding…" disabled={busy}>
              Add category
            </Button>
          </div>
        </div>
      </form>

      <div className="grid gap-3">
        {loading ? (
          <div className="rounded-2xl border border-dashed p-4 text-sm text-[hsl(var(--muted))]">Loading categories…</div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-4 text-sm text-[hsl(var(--muted))]">No categories found.</div>
        ) : (
          items.map((item) => {
            const editing = editingKey === item.key
            const row = editing ? editForm : { key: item.key, label: item.label, sort_order: item.sort_order, is_active: item.is_active }

            return (
              <div key={item.key} className="rounded-2xl border bg-white p-4">
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_auto_auto] xl:items-end">
                  <Input
                    label="Key"
                    value={row.key}
                    onChange={(e) => setEditForm((current) => ({ ...current, key: e.target.value }))}
                    disabled={!editing || busy}
                  />
                  <Input
                    label="Label"
                    value={row.label}
                    onChange={(e) => setEditForm((current) => ({ ...current, label: e.target.value }))}
                    disabled={!editing || busy}
                  />
                  <Input
                    label="Sort"
                    type="number"
                    value={row.sort_order}
                    onChange={(e) => setEditForm((current) => ({ ...current, sort_order: Number(e.target.value || 0) }))}
                    disabled={!editing || busy}
                  />
                  <label className="flex items-center gap-2 text-sm pb-2">
                    <input
                      type="checkbox"
                      checked={row.is_active}
                      onChange={(e) => setEditForm((current) => ({ ...current, is_active: e.target.checked }))}
                      disabled={!editing || busy}
                    />
                    Active
                  </label>
                  <div className="flex flex-wrap justify-end gap-2">
                    {editing ? (
                      <>
                        <Button type="button" variant="outline" onClick={cancelEdit} disabled={busy}>
                          Cancel
                        </Button>
                        <Button type="button" onClick={saveEdit} loading={busy} loadingText="Saving…" disabled={busy}>
                          Save
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button type="button" variant="outline" onClick={() => startEdit(item)} disabled={busy}>
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="border-rose-200 text-rose-700 hover:bg-rose-50"
                          onClick={() => removeCategory(item.key)}
                          disabled={busy}
                        >
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
