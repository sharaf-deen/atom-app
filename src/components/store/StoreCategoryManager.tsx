'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import InlineAlert from '@/components/ui/InlineAlert'
import Modal from '@/components/ui/Modal'
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

type BusyAction =
  | { type: 'create' }
  | { type: 'save'; key: string }
  | { type: 'delete'; key: string }
  | null

const EMPTY_FORM: CategoryFormState = {
  key: '',
  label: '',
  sort_order: 0,
  is_active: true,
}

function buildFriendlyCategoryError(message: string, action: 'create' | 'update' | 'delete' | 'load') {
  const source = String(message || '').trim()
  const lower = source.toLowerCase()

  if (!source) {
    switch (action) {
      case 'create':
        return 'Could not create the category.'
      case 'update':
        return 'Could not save category changes.'
      case 'delete':
        return 'Could not delete the category.'
      default:
        return 'Could not load categories.'
    }
  }

  if (lower.includes('duplicate key') || lower.includes('already exists') || lower.includes('unique constraint')) {
    return 'This key already exists. Use a different internal key.'
  }

  if (
    lower.includes('category_in_use') ||
    lower.includes('still use this category') ||
    lower.includes('product(s) still use') ||
    lower.includes('foreign key constraint') ||
    lower.includes('violates foreign key constraint') ||
    lower.includes('still referenced')
  ) {
    return 'Delete blocked. Products still use this category.'
  }

  return source
}

function usageTone(item: StoreCategoryRow) {
  return Number(item.product_count || 0) > 0
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : 'border-emerald-200 bg-emerald-50 text-emerald-700'
}

export default function StoreCategoryManager() {
  const router = useRouter()
  const [items, setItems] = useState<StoreCategoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [status, setStatus] = useState<{ kind: '' | 'success' | 'error'; msg: string }>({ kind: '', msg: '' })
  const [form, setForm] = useState<CategoryFormState>(EMPTY_FORM)
  const [editingKey, setEditingKey] = useState('')
  const [editForm, setEditForm] = useState<CategoryFormState>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<StoreCategoryRow | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)

  const isBusy = busyAction !== null
  const createBusy = busyAction?.type === 'create'
  const activeCount = useMemo(() => items.filter((item) => item.is_active).length, [items])
  const inactiveCount = useMemo(() => items.filter((item) => !item.is_active).length, [items])
  const usedCount = useMemo(() => items.filter((item) => Number(item.product_count || 0) > 0).length, [items])
  const nextNormalizedKey = useMemo(() => normalizeStoreCategoryKey(form.key), [form.key])
  const createPristine =
    !form.key.trim() && !form.label.trim() && Number(form.sort_order || 0) === 0 && form.is_active === EMPTY_FORM.is_active

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
        setStatus({
          kind: 'error',
          msg: buildFriendlyCategoryError(json?.details || json?.error || 'Failed to load categories.', 'load'),
        })
        return
      }
      const rows = Array.isArray(json.items) ? (json.items as StoreCategoryRow[]) : []
      setItems(sortStoreProductCategories(rows))
    } catch (e: any) {
      setItems([])
      setStatus({ kind: 'error', msg: buildFriendlyCategoryError(e?.message || 'Failed to load categories.', 'load') })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function resetCreateForm() {
    setForm(EMPTY_FORM)
    setStatus((current) => (current.kind === 'error' ? { kind: '', msg: '' } : current))
  }

  function startEdit(item: StoreCategoryRow) {
    setEditingKey(item.key)
    setEditForm({
      key: item.key,
      label: item.label,
      sort_order: Number(item.sort_order || 0),
      is_active: !!item.is_active,
    })
    setDeleteTarget(null)
    setStatus({ kind: '', msg: '' })
  }

  function cancelEdit() {
    setEditingKey('')
    setEditForm(EMPTY_FORM)
  }

  async function createCategory(e: React.FormEvent) {
    e.preventDefault()
    if (isBusy) return

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

    setBusyAction({ type: 'create' })
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
        const msg = buildFriendlyCategoryError(json?.details || json?.error || 'Create failed.', 'create')
        setStatus({ kind: 'error', msg })
        toast.error(msg)
        return
      }
      const nextItems = sortStoreProductCategories([
        ...items,
        { product_count: 0, ...(json.item as StoreCategoryRow) },
      ])
      setItems(nextItems)
      resetCreateForm()
      setStatus({ kind: 'success', msg: 'Category created successfully.' })
      toast.success('Category created')
      router.refresh()
    } catch (e: any) {
      const msg = buildFriendlyCategoryError(e?.message || 'Create failed.', 'create')
      setStatus({ kind: 'error', msg })
      toast.error(msg)
    } finally {
      setBusyAction(null)
    }
  }

  async function saveEdit() {
    if (!editingKey || isBusy) return
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

    setBusyAction({ type: 'save', key: editingKey })
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
        const msg = buildFriendlyCategoryError(json?.details || json?.error || 'Update failed.', 'update')
        setStatus({ kind: 'error', msg })
        toast.error(msg)
        return
      }
      const updated = json.item as StoreCategoryRow
      setItems((current) =>
        sortStoreProductCategories(
          current.map((item) => (item.key === editingKey ? { ...item, ...updated, product_count: item.product_count || 0 } : item))
        )
      )
      setEditingKey('')
      setEditForm(EMPTY_FORM)
      setStatus({ kind: 'success', msg: 'Category changes saved.' })
      toast.success('Category updated')
      router.refresh()
    } catch (e: any) {
      const msg = buildFriendlyCategoryError(e?.message || 'Update failed.', 'update')
      setStatus({ kind: 'error', msg })
      toast.error(msg)
    } finally {
      setBusyAction(null)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || isBusy) return

    setBusyAction({ type: 'delete', key: deleteTarget.key })
    setStatus({ kind: '', msg: '' })
    try {
      const res = await fetch(`/api/store/categories/delete?key=${encodeURIComponent(deleteTarget.key)}`, {
        method: 'DELETE',
        cache: 'no-store',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        const msg = buildFriendlyCategoryError(json?.details || json?.error || 'Delete failed.', 'delete')
        setStatus({ kind: 'error', msg })
        toast.error(msg)
        return
      }
      setItems((current) => current.filter((item) => item.key !== deleteTarget.key))
      setDeleteTarget(null)
      setStatus({ kind: 'success', msg: 'Category deleted successfully.' })
      toast.success('Category deleted')
      router.refresh()
    } catch (e: any) {
      const msg = buildFriendlyCategoryError(e?.message || 'Delete failed.', 'delete')
      setStatus({ kind: 'error', msg })
      toast.error(msg)
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Product categories</div>
          <div className="text-xs text-[hsl(var(--muted))]">Compact admin view. Manage labels, order and visibility.</div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 text-[11px] font-medium">
          <span className="rounded-full border px-2.5 py-1 text-[hsl(var(--muted))]">{items.length} total</span>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-700">{activeCount} active</span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700">{inactiveCount} inactive</span>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-700">{usedCount} in use</span>
          <Button type="button" size="sm" onClick={() => setShowCreateForm((current) => !current)} disabled={isBusy}>
            {showCreateForm ? 'Hide form' : 'Add category'}
          </Button>
        </div>
      </div>

      {status.msg ? (
        <InlineAlert variant={status.kind === 'error' ? 'error' : 'success'} compact>
          {status.msg}
        </InlineAlert>
      ) : null}

      {showCreateForm ? (
        <form onSubmit={createCategory} className="grid gap-3 rounded-2xl border bg-white p-3">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_100px_auto] xl:items-end">
            <Input
              label="Key *"
              value={form.key}
              onChange={(e) => setForm((current) => ({ ...current, key: e.target.value }))}
              placeholder="ex: gi_kids"
              hint={form.key.trim() ? `Saved as: ${nextNormalizedKey || '—'}` : undefined}
              disabled={isBusy}
            />
            <Input
              label="Label *"
              value={form.label}
              onChange={(e) => setForm((current) => ({ ...current, label: e.target.value }))}
              placeholder="ex: GI Kids"
              disabled={isBusy}
            />
            <Input
              label="Sort"
              type="number"
              value={form.sort_order}
              onChange={(e) => setForm((current) => ({ ...current, sort_order: Number(e.target.value || 0) }))}
              disabled={isBusy}
            />
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((current) => ({ ...current, is_active: e.target.checked }))}
                disabled={isBusy}
              />
              Active
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={resetCreateForm} disabled={isBusy || createPristine}>
              Reset
            </Button>
            <Button type="submit" loading={createBusy} loadingText="Adding…" disabled={isBusy}>
              Add category
            </Button>
          </div>
        </form>
      ) : null}

      <div className="overflow-hidden rounded-2xl border bg-white">
        {loading ? (
          <div className="p-4 text-sm text-[hsl(var(--muted))]">Loading categories…</div>
        ) : items.length === 0 ? (
          <div className="p-4 text-sm text-[hsl(var(--muted))]">No categories found yet.</div>
        ) : (
          <div className="divide-y">
            {items.map((item) => {
              const editing = editingKey === item.key
              const row = editing
                ? editForm
                : { key: item.key, label: item.label, sort_order: item.sort_order, is_active: item.is_active }
              const productCount = Number(item.product_count || 0)
              const deleteBlocked = productCount > 0
              const saveBusy = busyAction?.type === 'save' && busyAction.key === item.key
              const deleteBusy = busyAction?.type === 'delete' && busyAction.key === item.key

              return (
                <div key={item.key} className={`${!item.is_active ? 'bg-slate-50/60' : 'bg-white'} p-3`}>
                  {!editing ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-sm font-semibold text-black">{item.label}</div>
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                            Order {Number(item.sort_order || 0)}
                          </span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                              item.is_active
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-slate-200 bg-slate-100 text-slate-700'
                            }`}
                          >
                            {item.is_active ? 'Active' : 'Inactive'}
                          </span>
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${usageTone(item)}`}>
                            {deleteBlocked ? `${productCount} linked` : 'Unused'}
                          </span>
                        </div>
                        <div className="mt-1 truncate text-xs text-[hsl(var(--muted))]">Key: {item.key}</div>
                      </div>

                      <div className="flex shrink-0 flex-wrap justify-end gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => startEdit(item)} disabled={isBusy}>
                          Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="border-rose-200 text-rose-700 hover:bg-rose-50"
                          onClick={() => setDeleteTarget(item)}
                          loading={deleteBusy}
                          loadingText="Deleting…"
                          disabled={isBusy || deleteBlocked}
                          title={deleteBlocked ? `Delete blocked: ${productCount} product(s) still use this category.` : 'Delete category'}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-black">Editing {item.label}</div>
                        {deleteBlocked ? (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                            {productCount} linked
                          </span>
                        ) : null}
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_100px_auto_auto] xl:items-end">
                        <Input
                          label="Key"
                          value={row.key}
                          onChange={(e) => setEditForm((current) => ({ ...current, key: e.target.value }))}
                          hint={`Saved as: ${normalizeStoreCategoryKey(row.key) || '—'}`}
                          disabled={isBusy}
                        />
                        <Input
                          label="Label"
                          value={row.label}
                          onChange={(e) => setEditForm((current) => ({ ...current, label: e.target.value }))}
                          disabled={isBusy}
                        />
                        <Input
                          label="Sort"
                          type="number"
                          value={row.sort_order}
                          onChange={(e) => setEditForm((current) => ({ ...current, sort_order: Number(e.target.value || 0) }))}
                          disabled={isBusy}
                        />
                        <label className="flex items-center gap-2 pb-2 text-sm">
                          <input
                            type="checkbox"
                            checked={row.is_active}
                            onChange={(e) => setEditForm((current) => ({ ...current, is_active: e.target.checked }))}
                            disabled={isBusy}
                          />
                          Active
                        </label>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={cancelEdit} disabled={isBusy}>
                            Cancel
                          </Button>
                          <Button type="button" size="sm" onClick={saveEdit} loading={saveBusy} loadingText="Saving…" disabled={isBusy}>
                            Save
                          </Button>
                        </div>
                      </div>

                      {deleteBlocked ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                          Delete is blocked while this category is linked to existing products.
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Modal
        open={!!deleteTarget}
        onClose={() => !isBusy && setDeleteTarget(null)}
        title="Delete category"
        className="w-[min(92vw,34rem)]"
      >
        {deleteTarget ? (
          <div className="space-y-4">
            <div className="text-sm text-[hsl(var(--muted))]">
              You are about to delete <span className="font-semibold text-black">{deleteTarget.label}</span>.
            </div>

            <div className="rounded-2xl border bg-[hsl(var(--surface-2))] p-3 text-sm">
              <div><span className="font-semibold">Key:</span> {deleteTarget.key}</div>
              <div><span className="font-semibold">Sort:</span> {Number(deleteTarget.sort_order || 0)}</div>
              <div><span className="font-semibold">Status:</span> {deleteTarget.is_active ? 'Active' : 'Inactive'}</div>
              <div><span className="font-semibold">Linked products:</span> {Number(deleteTarget.product_count || 0)}</div>
            </div>

            <InlineAlert variant="warning" compact>
              This only works when no product still uses the category.
            </InlineAlert>

            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)} disabled={isBusy}>
                Cancel
              </Button>
              <Button
                type="button"
                className="bg-rose-600 border-rose-600 hover:opacity-95"
                onClick={confirmDelete}
                loading={busyAction?.type === 'delete' && busyAction.key === deleteTarget.key}
                loadingText="Deleting…"
                disabled={isBusy}
              >
                Confirm delete
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
