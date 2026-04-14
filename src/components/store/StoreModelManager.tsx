'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import InlineAlert from '@/components/ui/InlineAlert'
import Modal from '@/components/ui/Modal'
import StoreProductForm from '@/components/StoreProductForm'
import AdminProductQuickEdit from '@/components/store/AdminProductQuickEdit'
import { buildStoreCategoryOptions, sortStoreProductCategories, type StoreProductCategoryRow } from '@/lib/storeCategories'
import {
  getStoreModelSuggestions,
  normalizeStoreModelSlug,
  sortStoreModels,
  type StoreProductModelRow,
} from '@/lib/storeModels'

type ModelFormState = {
  category_key: string
  name: string
  slug: string
  description: string
  cover_image_path: string
  sort_order: number
  is_active: boolean
  is_featured: boolean
}

type BusyAction =
  | { type: 'create' }
  | { type: 'save'; id: string }
  | { type: 'delete'; id: string }
  | null

type LinkedVariantRow = {
  id: string
  category: string
  model_id: string | null
  name: string
  color: string | null
  size: string | null
  price_cents: number
  currency: string | null
  inventory_qty: number
  is_active: boolean
  allow_preorder: boolean
  low_stock_threshold: number
  created_at: string
}

const EMPTY_FORM: ModelFormState = {
  category_key: '',
  name: '',
  slug: '',
  description: '',
  cover_image_path: '',
  sort_order: 0,
  is_active: true,
  is_featured: false,
}

function buildFriendlyModelError(message: string, action: 'create' | 'update' | 'delete' | 'load') {
  const source = String(message || '').trim()
  const lower = source.toLowerCase()

  if (!source) {
    switch (action) {
      case 'create':
        return 'Could not create the model.'
      case 'update':
        return 'Could not save model changes.'
      case 'delete':
        return 'Could not delete the model.'
      default:
        return 'Could not load models.'
    }
  }

  if (lower.includes('duplicate key') || lower.includes('already exists') || lower.includes('unique')) {
    return 'This slug already exists in the selected category.'
  }

  if (lower.includes('model_in_use') || lower.includes('still linked')) {
    return source
  }

  return source
}

function toVariantLabel(item: Pick<LinkedVariantRow, 'name' | 'color' | 'size'>) {
  return [item.name, item.color, item.size].filter(Boolean).join(' · ') || 'Unnamed variant'
}

function formatPrice(cents: number, currency?: string | null) {
  return `${currency || 'EGP'} ${(Number(cents || 0) / 100).toFixed(2)}`
}

export default function StoreModelManager() {
  const router = useRouter()
  const [categories, setCategories] = useState<StoreProductCategoryRow[]>([])
  const [items, setItems] = useState<StoreProductModelRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [status, setStatus] = useState<{ kind: '' | 'success' | 'error'; msg: string }>({ kind: '', msg: '' })
  const [form, setForm] = useState<ModelFormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState('')
  const [editForm, setEditForm] = useState<ModelFormState>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<StoreProductModelRow | null>(null)
  const [expandedModelId, setExpandedModelId] = useState('')
  const [variantsByModel, setVariantsByModel] = useState<Record<string, LinkedVariantRow[]>>({})
  const [variantsLoadingId, setVariantsLoadingId] = useState('')
  const [variantsErrorByModel, setVariantsErrorByModel] = useState<Record<string, string>>({})
  const [createVariantTarget, setCreateVariantTarget] = useState<StoreProductModelRow | null>(null)
  const [showUnlinkedQueue, setShowUnlinkedQueue] = useState(true)
  const [unlinkedItems, setUnlinkedItems] = useState<LinkedVariantRow[]>([])
  const [unlinkedTotal, setUnlinkedTotal] = useState(0)
  const [unlinkedLoading, setUnlinkedLoading] = useState(false)
  const [unlinkedError, setUnlinkedError] = useState('')
  const [unlinkedCategory, setUnlinkedCategory] = useState('')
  const [unlinkedQuery, setUnlinkedQuery] = useState('')
  const [quickLinkingVariantId, setQuickLinkingVariantId] = useState('')

  const isBusy = busyAction !== null
  const createBusy = busyAction?.type === 'create'

  const activeCategories = useMemo(() => sortStoreProductCategories(categories.filter((item) => item.is_active)), [categories])
  const categoryOptions = useMemo(() => buildStoreCategoryOptions(activeCategories, { includeAll: false }), [activeCategories])
  const categoryLabelMap = useMemo(() => new Map(categories.map((item) => [item.key, item.label])), [categories])
  const activeCount = useMemo(() => items.filter((item) => item.is_active).length, [items])
  const inactiveCount = useMemo(() => items.filter((item) => !item.is_active).length, [items])
  const usedCount = useMemo(() => items.filter((item) => Number(item.linked_product_count || 0) > 0).length, [items])
  const featuredCount = useMemo(() => items.filter((item) => item.is_featured).length, [items])
  const linkedVariantCount = useMemo(() => items.reduce((sum, item) => sum + Number(item.linked_product_count || 0), 0), [items])
  const unlinkedActiveCount = useMemo(() => unlinkedItems.filter((item) => item.is_active).length, [unlinkedItems])
  const unlinkedLowStockCount = useMemo(
    () => unlinkedItems.filter((item) => Number(item.inventory_qty || 0) <= Number(item.low_stock_threshold || 0)).length,
    [unlinkedItems]
  )
  const coveragePercent = useMemo(() => {
    const total = linkedVariantCount + unlinkedTotal
    return total > 0 ? Math.round((linkedVariantCount / total) * 100) : 0
  }, [linkedVariantCount, unlinkedTotal])
  const nextCreateSlug = useMemo(() => normalizeStoreModelSlug(form.slug || form.name), [form.slug, form.name])
  const nextEditSlug = useMemo(() => normalizeStoreModelSlug(editForm.slug || editForm.name), [editForm.slug, editForm.name])

  async function load() {
    setLoading(true)
    setStatus((current) => (current.kind === 'error' ? { kind: '', msg: '' } : current))
    try {
      const [categoriesRes, modelsRes] = await Promise.all([
        fetch('/api/store/categories/list?include_inactive=1', { cache: 'no-store', credentials: 'include' }),
        fetch('/api/store/models/list', { cache: 'no-store', credentials: 'include' }),
      ])
      const categoriesJson = await categoriesRes.json().catch(() => ({}))
      const modelsJson = await modelsRes.json().catch(() => ({}))

      if (!categoriesRes.ok || !categoriesJson?.ok) {
        setCategories([])
        setItems([])
        setStatus({
          kind: 'error',
          msg: buildFriendlyModelError(categoriesJson?.details || categoriesJson?.error || 'Failed to load categories.', 'load'),
        })
        return
      }

      if (!modelsRes.ok || !modelsJson?.ok) {
        setCategories(Array.isArray(categoriesJson.items) ? (categoriesJson.items as StoreProductCategoryRow[]) : [])
        setItems([])
        setStatus({
          kind: 'error',
          msg: buildFriendlyModelError(modelsJson?.details || modelsJson?.error || 'Failed to load models.', 'load'),
        })
        return
      }

      const nextCategories = Array.isArray(categoriesJson.items) ? (categoriesJson.items as StoreProductCategoryRow[]) : []
      const nextItems = Array.isArray(modelsJson.items) ? (modelsJson.items as StoreProductModelRow[]) : []
      setCategories(sortStoreProductCategories(nextCategories))
      setItems(sortStoreModels(nextItems))
      setForm((current) => ({
        ...current,
        category_key: current.category_key || nextCategories.find((item) => item.is_active)?.key || '',
      }))
    } catch (e: any) {
      setCategories([])
      setItems([])
      setStatus({ kind: 'error', msg: buildFriendlyModelError(e?.message || 'Failed to load models.', 'load') })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    void loadUnlinkedQueue()
  }, [unlinkedCategory, unlinkedQuery])

  async function loadVariants(modelId: string, force = false) {
    if (!modelId) return
    if (!force && variantsByModel[modelId]) return
    setVariantsLoadingId(modelId)
    setVariantsErrorByModel((current) => ({ ...current, [modelId]: '' }))
    try {
      const res = await fetch(`/api/store/products/list?all=1&page=1&limit=100&model_id=${encodeURIComponent(modelId)}`, {
        cache: 'no-store',
        credentials: 'include',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setVariantsByModel((current) => ({ ...current, [modelId]: [] }))
        setVariantsErrorByModel((current) => ({
          ...current,
          [modelId]: json?.details || json?.error || 'Could not load linked variants.',
        }))
        return
      }
      const rows = Array.isArray(json.items) ? (json.items as LinkedVariantRow[]) : []
      setVariantsByModel((current) => ({ ...current, [modelId]: rows }))
    } catch (e: any) {
      setVariantsByModel((current) => ({ ...current, [modelId]: [] }))
      setVariantsErrorByModel((current) => ({
        ...current,
        [modelId]: e?.message || 'Could not load linked variants.',
      }))
    } finally {
      setVariantsLoadingId('')
    }
  }

  async function loadUnlinkedQueue(nextCategory = unlinkedCategory, nextQuery = unlinkedQuery) {
    setUnlinkedLoading(true)
    setUnlinkedError('')
    try {
      const params = new URLSearchParams({
        all: '1',
        page: '1',
        limit: '200',
        linked_state: 'unlinked',
      })
      if (String(nextCategory || '').trim()) params.set('category', String(nextCategory).trim())
      if (String(nextQuery || '').trim()) params.set('q', String(nextQuery).trim())

      const res = await fetch(`/api/store/products/list?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'include',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        setUnlinkedItems([])
        setUnlinkedTotal(0)
        setUnlinkedError(json?.details || json?.error || 'Could not load unlinked variants.')
        return
      }
      setUnlinkedItems(Array.isArray(json.items) ? (json.items as LinkedVariantRow[]) : [])
      setUnlinkedTotal(Number(json.total || 0))
    } catch (e: any) {
      setUnlinkedItems([])
      setUnlinkedTotal(0)
      setUnlinkedError(e?.message || 'Could not load unlinked variants.')
    } finally {
      setUnlinkedLoading(false)
    }
  }

  async function quickLinkVariant(variant: LinkedVariantRow, model: StoreProductModelRow) {
    if (!variant?.id || !model?.id || quickLinkingVariantId) return
    setQuickLinkingVariantId(variant.id)
    try {
      const res = await fetch('/api/store/products/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: variant.id,
          category: variant.category,
          model_id: model.id,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        const msg = json?.details || json?.error || 'Could not link this variant to the selected model.'
        toast.error(msg)
        return
      }
      toast.success(`Linked to ${model.name}`)
      await Promise.all([load(), loadUnlinkedQueue()])
      if (expandedModelId === model.id) {
        await loadVariants(model.id, true)
      }
      router.refresh()
    } catch (e: any) {
      toast.error(e?.message || 'Could not link this variant to the selected model.')
    } finally {
      setQuickLinkingVariantId('')
    }
  }

  function resetCreateForm() {
    setForm({
      ...EMPTY_FORM,
      category_key: activeCategories[0]?.key || '',
    })
    setStatus((current) => (current.kind === 'error' ? { kind: '', msg: '' } : current))
  }

  function startEdit(item: StoreProductModelRow) {
    setEditingId(item.id)
    setEditForm({
      category_key: item.category_key,
      name: item.name,
      slug: item.slug,
      description: item.description || '',
      cover_image_path: item.cover_image_path || '',
      sort_order: Number(item.sort_order || 0),
      is_active: !!item.is_active,
      is_featured: !!item.is_featured,
    })
    setDeleteTarget(null)
    setStatus({ kind: '', msg: '' })
  }

  function cancelEdit() {
    setEditingId('')
    setEditForm(EMPTY_FORM)
  }

  async function createModel(e: React.FormEvent) {
    e.preventDefault()
    if (isBusy) return

    const categoryKey = String(form.category_key || '').trim()
    const name = form.name.trim()
    const slug = normalizeStoreModelSlug(form.slug || form.name)
    if (!categoryKey) {
      setStatus({ kind: 'error', msg: 'Category is required.' })
      toast.error('Select a category')
      return
    }
    if (!name) {
      setStatus({ kind: 'error', msg: 'Model name is required.' })
      toast.error('Model name is required')
      return
    }
    if (!slug) {
      setStatus({ kind: 'error', msg: 'Slug is required.' })
      toast.error('Model slug is required')
      return
    }

    setBusyAction({ type: 'create' })
    setStatus({ kind: '', msg: '' })
    try {
      const res = await fetch('/api/store/models/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category_key: categoryKey,
          name,
          slug,
          description: form.description.trim(),
          cover_image_path: form.cover_image_path.trim(),
          sort_order: Number(form.sort_order || 0),
          is_active: !!form.is_active,
          is_featured: !!form.is_featured,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        const msg = buildFriendlyModelError(json?.details || json?.error || 'Create failed.', 'create')
        setStatus({ kind: 'error', msg })
        toast.error(msg)
        return
      }
      setItems((current) => sortStoreModels([...current, json.item as StoreProductModelRow]))
      resetCreateForm()
      setStatus({ kind: 'success', msg: 'Model created successfully.' })
      toast.success('Model created')
      router.refresh()
    } catch (e: any) {
      const msg = buildFriendlyModelError(e?.message || 'Create failed.', 'create')
      setStatus({ kind: 'error', msg })
      toast.error(msg)
    } finally {
      setBusyAction(null)
    }
  }

  async function saveEdit() {
    if (!editingId || isBusy) return
    const categoryKey = String(editForm.category_key || '').trim()
    const name = editForm.name.trim()
    const slug = normalizeStoreModelSlug(editForm.slug || editForm.name)
    if (!categoryKey) {
      setStatus({ kind: 'error', msg: 'Category is required.' })
      toast.error('Select a category')
      return
    }
    if (!name) {
      setStatus({ kind: 'error', msg: 'Model name is required.' })
      toast.error('Model name is required')
      return
    }
    if (!slug) {
      setStatus({ kind: 'error', msg: 'Slug is required.' })
      toast.error('Model slug is required')
      return
    }

    setBusyAction({ type: 'save', id: editingId })
    setStatus({ kind: '', msg: '' })
    try {
      const res = await fetch('/api/store/models/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId,
          category_key: categoryKey,
          name,
          slug,
          description: editForm.description.trim(),
          cover_image_path: editForm.cover_image_path.trim(),
          sort_order: Number(editForm.sort_order || 0),
          is_active: !!editForm.is_active,
          is_featured: !!editForm.is_featured,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        const msg = buildFriendlyModelError(json?.details || json?.error || 'Update failed.', 'update')
        setStatus({ kind: 'error', msg })
        toast.error(msg)
        return
      }
      const updated = json.item as StoreProductModelRow
      setItems((current) => sortStoreModels(current.map((item) => (item.id === editingId ? updated : item))))
      setEditingId('')
      setEditForm(EMPTY_FORM)
      setStatus({ kind: 'success', msg: 'Model changes saved.' })
      toast.success('Model updated')
      router.refresh()
    } catch (e: any) {
      const msg = buildFriendlyModelError(e?.message || 'Update failed.', 'update')
      setStatus({ kind: 'error', msg })
      toast.error(msg)
    } finally {
      setBusyAction(null)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || isBusy) return
    setBusyAction({ type: 'delete', id: deleteTarget.id })
    setStatus({ kind: '', msg: '' })
    try {
      const res = await fetch(`/api/store/models/delete?id=${encodeURIComponent(deleteTarget.id)}`, {
        method: 'DELETE',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        const msg = buildFriendlyModelError(json?.details || json?.error || 'Delete failed.', 'delete')
        setStatus({ kind: 'error', msg })
        toast.error(msg)
        return
      }
      setItems((current) => current.filter((item) => item.id !== deleteTarget.id))
      setDeleteTarget(null)
      setVariantsByModel((current) => {
        const next = { ...current }
        delete next[deleteTarget.id]
        return next
      })
      setVariantsErrorByModel((current) => {
        const next = { ...current }
        delete next[deleteTarget.id]
        return next
      })
      setStatus({ kind: 'success', msg: 'Model deleted successfully.' })
      toast.success('Model deleted')
      router.refresh()
    } catch (e: any) {
      const msg = buildFriendlyModelError(e?.message || 'Delete failed.', 'delete')
      setStatus({ kind: 'error', msg })
      toast.error(msg)
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div className="space-y-4">
      {status.kind ? <InlineAlert variant={status.kind === 'error' ? 'error' : 'success'}>{status.msg}</InlineAlert> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-2xl border bg-white px-4 py-3">
          <div className="text-xs text-[hsl(var(--muted))]">Models</div>
          <div className="mt-1 text-xl font-semibold">{items.length}</div>
        </div>
        <div className="rounded-2xl border bg-white px-4 py-3">
          <div className="text-xs text-[hsl(var(--muted))]">Active models</div>
          <div className="mt-1 text-xl font-semibold">{activeCount}</div>
        </div>
        <div className="rounded-2xl border bg-white px-4 py-3">
          <div className="text-xs text-[hsl(var(--muted))]">Inactive models</div>
          <div className="mt-1 text-xl font-semibold">{inactiveCount}</div>
        </div>
        <div className="rounded-2xl border bg-white px-4 py-3">
          <div className="text-xs text-[hsl(var(--muted))]">Models with variants</div>
          <div className="mt-1 text-xl font-semibold">{usedCount}</div>
        </div>
        <div className="rounded-2xl border bg-white px-4 py-3">
          <div className="text-xs text-[hsl(var(--muted))]">Linked variants</div>
          <div className="mt-1 text-xl font-semibold">{linkedVariantCount}</div>
        </div>
        <div className="rounded-2xl border bg-white px-4 py-3">
          <div className="text-xs text-[hsl(var(--muted))]">Coverage</div>
          <div className="mt-1 text-xl font-semibold">{coveragePercent}%</div>
        </div>
      </div>

      <form onSubmit={createModel} className="grid gap-3 rounded-2xl border bg-white p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-black">Category</span>
            <select
              value={form.category_key}
              onChange={(e) => setForm((current) => ({ ...current, category_key: e.target.value }))}
              className="min-h-[44px] w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3.5 py-2.5 text-sm text-black shadow-soft outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              disabled={isBusy || activeCategories.length === 0}
            >
              <option value="">Select a category</option>
              {categoryOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <Input
            label="Model name"
            value={form.name}
            onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
            placeholder="Example: Atom Pro Gi"
            disabled={isBusy}
          />
          <Input
            label="Slug"
            value={form.slug}
            onChange={(e) => setForm((current) => ({ ...current, slug: e.target.value }))}
            placeholder="atom_pro_gi"
            hint={`Preview: ${nextCreateSlug || '—'}`}
            disabled={isBusy}
          />
          <Input
            label="Sort order"
            type="number"
            value={String(form.sort_order)}
            onChange={(e) => setForm((current) => ({ ...current, sort_order: Number(e.target.value || 0) }))}
            disabled={isBusy}
          />
          <Input
            label="Cover image path"
            value={form.cover_image_path}
            onChange={(e) => setForm((current) => ({ ...current, cover_image_path: e.target.value }))}
            placeholder="store/products/atom-pro-gi-cover.webp"
            disabled={isBusy}
            className="md:col-span-2"
          />
          <label className="block md:col-span-2">
            <span className="mb-1.5 block text-sm font-semibold text-black">Description</span>
            <textarea
              value={form.description}
              onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
              rows={3}
              disabled={isBusy}
              className="min-h-[96px] w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3.5 py-2.5 text-sm text-black shadow-soft outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((current) => ({ ...current, is_active: e.target.checked }))} disabled={isBusy} />
            Active
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_featured} onChange={(e) => setForm((current) => ({ ...current, is_featured: e.target.checked }))} disabled={isBusy} />
            Featured
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={createBusy} loadingText="Creating…">Create model</Button>
          <Button type="button" variant="outline" onClick={resetCreateForm} disabled={isBusy}>Reset</Button>
        </div>
      </form>

      <div className="rounded-2xl border bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-black">Variant linking queue</div>
            <div className="mt-1 text-xs text-[hsl(var(--muted))]">Find legacy variants that still need a Store V3 model link. Use the suggested quick-link buttons when the match looks right, or fall back to Edit details for a manual attach.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowUnlinkedQueue((current) => !current)}>
              {showUnlinkedQueue ? 'Hide queue' : 'Show queue'}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadUnlinkedQueue()} disabled={unlinkedLoading}>
              {unlinkedLoading ? 'Refreshing…' : 'Refresh queue'}
            </Button>
          </div>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_auto]">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-black">Category filter</span>
            <select
              value={unlinkedCategory}
              onChange={(e) => setUnlinkedCategory(e.target.value)}
              className="min-h-[44px] w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3.5 py-2.5 text-sm text-black shadow-soft outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value="">All categories</option>
              {categoryOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <Input
            label="Search unlinked variants"
            value={unlinkedQuery}
            onChange={(e) => setUnlinkedQuery(e.target.value)}
            placeholder="Variant name, color, size"
          />

          <div className="flex items-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setUnlinkedCategory('')
                setUnlinkedQuery('')
              }}
              disabled={!unlinkedCategory && !unlinkedQuery}
            >
              Reset filters
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
          <span className="rounded-full border bg-slate-50 px-2 py-1">Unlinked variants: {unlinkedTotal}</span>
          <span className="rounded-full border bg-slate-50 px-2 py-1">Active in queue: {unlinkedActiveCount}</span>
          <span className="rounded-full border bg-slate-50 px-2 py-1">Low stock in queue: {unlinkedLowStockCount}</span>
          <span className="rounded-full border bg-slate-50 px-2 py-1">Featured models: {featuredCount}</span>
        </div>

        {showUnlinkedQueue ? (
          <div className="mt-3">
            {unlinkedError ? <InlineAlert variant="error">{unlinkedError}</InlineAlert> : null}

            {unlinkedLoading ? (
              <div className="rounded-2xl border border-dashed p-4 text-sm text-[hsl(var(--muted))]">Loading unlinked variants…</div>
            ) : unlinkedItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-4 text-sm text-[hsl(var(--muted))]">No unlinked variants match the current filters.</div>
            ) : (
              <div className="space-y-3">
                {unlinkedItems.map((variant) => {
                  const suggestions = getStoreModelSuggestions(items, variant, 3)
                  const quickLinkBusy = quickLinkingVariantId === variant.id
                  return (
                  <div key={variant.id} className="rounded-2xl border bg-slate-50/70 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{toVariantLabel(variant)}</div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
                          <span className="rounded-full border bg-white px-2 py-1">{categoryLabelMap.get(variant.category) || variant.category}</span>
                          <span className="rounded-full border bg-white px-2 py-1">{formatPrice(variant.price_cents, variant.currency)}</span>
                          <span className="rounded-full border bg-white px-2 py-1">Stock: {variant.inventory_qty}</span>
                          <span className={`rounded-full border px-2 py-1 ${variant.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                            {variant.is_active ? 'Active' : 'Inactive'}
                          </span>
                          <span className={`rounded-full border px-2 py-1 ${variant.allow_preorder ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                            {variant.allow_preorder ? 'Preorder on' : 'Preorder off'}
                          </span>
                        </div>
                        <div className="mt-3 rounded-2xl border bg-white p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs font-semibold text-black">Suggested models</div>
                            <div className="text-[11px] text-[hsl(var(--muted))]">Quick-link only when the match is clearly correct.</div>
                          </div>
                          {suggestions.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {suggestions.map((suggestion) => (
                                <Button
                                  key={suggestion.id}
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={quickLinkBusy}
                                  onClick={() => void quickLinkVariant(variant, suggestion)}
                                >
                                  {quickLinkBusy ? 'Linking…' : `Link to ${suggestion.name}`}
                                </Button>
                              ))}
                            </div>
                          ) : (
                            <div className="mt-2 text-xs text-[hsl(var(--muted))]">No strong automatic match found. Use Edit details for a manual link.</div>
                          )}
                        </div>
                        <div className="mt-2 text-xs text-[hsl(var(--muted))]">Use Edit details to review the variant and attach a model manually when needed.</div>
                      </div>
                    </div>
                    <div className="mt-3">
                      <AdminProductQuickEdit
                        id={variant.id}
                        category={variant.category}
                        modelId={variant.model_id}
                        name={variant.name}
                        color={variant.color}
                        size={variant.size}
                        priceCents={variant.price_cents}
                        currency={variant.currency}
                        inventoryQty={variant.inventory_qty}
                        isActive={variant.is_active}
                        allowPreorder={variant.allow_preorder}
                        lowStockThreshold={variant.low_stock_threshold}
                        onSaved={() => {
                          void load()
                          void loadUnlinkedQueue()
                        }}
                        onDeleted={() => {
                          void load()
                          void loadUnlinkedQueue()
                        }}
                      />
                    </div>
                  </div>
                )})}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="rounded-2xl border border-dashed p-4 text-sm text-[hsl(var(--muted))]">Loading models…</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-4 text-sm text-[hsl(var(--muted))]">No models created yet.</div>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => {
            const isEditing = editingId === item.id
            const isDeleteBusy = busyAction?.type === 'delete' && busyAction.id === item.id
            const isExpanded = expandedModelId === item.id
            const variants = variantsByModel[item.id] || []
            const variantsLoading = variantsLoadingId === item.id
            const variantsError = variantsErrorByModel[item.id] || ''
            const activeVariants = variants.filter((variant) => variant.is_active).length
            const totalStock = variants.reduce((sum, variant) => sum + Number(variant.inventory_qty || 0), 0)
            const lowStockCount = variants.filter((variant) => Number(variant.inventory_qty || 0) <= Number(variant.low_stock_threshold || 0)).length
            return (
              <div key={item.id} className="rounded-2xl border bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{item.name}</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
                      <span className="rounded-full border px-2 py-1">{item.category_label || categoryLabelMap.get(item.category_key) || item.category_key}</span>
                      <span className="rounded-full border px-2 py-1">Slug: {item.slug}</span>
                      <span className={`rounded-full border px-2 py-1 ${item.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                        {item.is_active ? 'Active' : 'Inactive'}
                      </span>
                      {item.is_featured ? <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-violet-700">Featured</span> : null}
                      <span className={`rounded-full border px-2 py-1 ${Number(item.linked_product_count || 0) > 0 ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                        {Number(item.linked_product_count || 0) > 0 ? `${item.linked_product_count} product(s) linked` : 'Unused'}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        const nextOpen = expandedModelId === item.id ? '' : item.id
                        setExpandedModelId(nextOpen)
                        if (nextOpen) await loadVariants(item.id)
                      }}
                    >
                      {isExpanded ? 'Hide variants' : 'Variants'}
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setCreateVariantTarget(item)} disabled={isBusy}>
                      Add variant
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => startEdit(item)} disabled={isBusy}>Edit</Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setDeleteTarget(item)} disabled={isBusy || isDeleteBusy}>Delete</Button>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
                  <div><span className="text-[hsl(var(--muted))]">Sort:</span> <span className="font-medium">{item.sort_order}</span></div>
                  <div><span className="text-[hsl(var(--muted))]">Updated:</span> <span className="font-medium">{item.updated_at ? new Date(item.updated_at).toLocaleDateString('en-GB') : '—'}</span></div>
                  <div className="sm:col-span-2 xl:col-span-2"><span className="text-[hsl(var(--muted))]">Cover:</span> <span className="font-medium break-all">{item.cover_image_path || '—'}</span></div>
                </div>

                {item.description ? <div className="mt-3 text-sm text-[hsl(var(--muted))]">{item.description}</div> : null}

                {isExpanded ? (
                  <div className="mt-4 rounded-2xl border bg-slate-50/70 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
                        <span className="rounded-full border bg-white px-2 py-1">Variants: {variants.length}</span>
                        <span className="rounded-full border bg-white px-2 py-1">Active: {activeVariants}</span>
                        <span className="rounded-full border bg-white px-2 py-1">Total stock: {totalStock}</span>
                        <span className="rounded-full border bg-white px-2 py-1">Low stock: {lowStockCount}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => loadVariants(item.id, true)} disabled={variantsLoading}>
                          {variantsLoading ? 'Refreshing…' : 'Refresh'}
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => setCreateVariantTarget(item)}>
                          Add variant
                        </Button>
                      </div>
                    </div>

                    {variantsError ? (
                      <div className="mt-3">
                        <InlineAlert variant="error">{variantsError}</InlineAlert>
                      </div>
                    ) : null}

                    {variantsLoading ? (
                      <div className="mt-3 rounded-2xl border border-dashed bg-white p-4 text-sm text-[hsl(var(--muted))]">Loading linked variants…</div>
                    ) : variants.length === 0 ? (
                      <div className="mt-3 rounded-2xl border border-dashed bg-white p-4 text-sm text-[hsl(var(--muted))]">
                        No linked variants yet. Create the first variant for this model.
                      </div>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {variants.map((variant) => (
                          <div key={variant.id} className="rounded-2xl border bg-white p-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold">{toVariantLabel(variant)}</div>
                                <div className="mt-1 flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
                                  <span className={`rounded-full border px-2 py-1 ${variant.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                                    {variant.is_active ? 'Active' : 'Inactive'}
                                  </span>
                                  <span className="rounded-full border px-2 py-1">{formatPrice(variant.price_cents, variant.currency)}</span>
                                  <span className="rounded-full border px-2 py-1">Stock: {variant.inventory_qty}</span>
                                  <span className={`rounded-full border px-2 py-1 ${variant.allow_preorder ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                                    {variant.allow_preorder ? 'Preorder on' : 'Preorder off'}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="mt-3">
                              <AdminProductQuickEdit
                                id={variant.id}
                                category={variant.category}
                                modelId={variant.model_id}
                                modelName={item.name}
                                name={variant.name}
                                color={variant.color}
                                size={variant.size}
                                priceCents={variant.price_cents}
                                currency={variant.currency}
                                inventoryQty={variant.inventory_qty}
                                isActive={variant.is_active}
                                allowPreorder={variant.allow_preorder}
                                lowStockThreshold={variant.low_stock_threshold}
                                onSaved={() => {
                                  void load()
                                  void loadVariants(item.id, true)
                                  void loadUnlinkedQueue()
                                }}
                                onDeleted={() => {
                                  void load()
                                  void loadVariants(item.id, true)
                                  void loadUnlinkedQueue()
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}

                <Modal open={isEditing} onClose={cancelEdit} title="Edit model" className="w-[min(92vw,44rem)]">
                  <div className="grid gap-3">
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-semibold text-black">Category</span>
                      <select
                        value={editForm.category_key}
                        onChange={(e) => setEditForm((current) => ({ ...current, category_key: e.target.value }))}
                        className="min-h-[44px] w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3.5 py-2.5 text-sm text-black shadow-soft outline-none"
                        disabled={isBusy}
                      >
                        <option value="">Select a category</option>
                        {categoryOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <Input label="Model name" value={editForm.name} onChange={(e) => setEditForm((current) => ({ ...current, name: e.target.value }))} disabled={isBusy} />
                    <Input label="Slug" value={editForm.slug} onChange={(e) => setEditForm((current) => ({ ...current, slug: e.target.value }))} hint={`Preview: ${nextEditSlug || '—'}`} disabled={isBusy} />
                    <Input label="Sort order" type="number" value={String(editForm.sort_order)} onChange={(e) => setEditForm((current) => ({ ...current, sort_order: Number(e.target.value || 0) }))} disabled={isBusy} />
                    <Input label="Cover image path" value={editForm.cover_image_path} onChange={(e) => setEditForm((current) => ({ ...current, cover_image_path: e.target.value }))} disabled={isBusy} />
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-semibold text-black">Description</span>
                      <textarea
                        value={editForm.description}
                        onChange={(e) => setEditForm((current) => ({ ...current, description: e.target.value }))}
                        rows={4}
                        disabled={isBusy}
                        className="min-h-[120px] w-full rounded-2xl border border-[hsl(var(--border))] bg-white px-3.5 py-2.5 text-sm text-black shadow-soft outline-none"
                      />
                    </label>
                    <div className="flex flex-wrap gap-4">
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={editForm.is_active} onChange={(e) => setEditForm((current) => ({ ...current, is_active: e.target.checked }))} disabled={isBusy} />
                        Active
                      </label>
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={editForm.is_featured} onChange={(e) => setEditForm((current) => ({ ...current, is_featured: e.target.checked }))} disabled={isBusy} />
                        Featured
                      </label>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button type="button" variant="outline" onClick={cancelEdit} disabled={isBusy}>Cancel</Button>
                      <Button type="button" onClick={saveEdit} loading={busyAction?.type === 'save' && busyAction.id === item.id} loadingText="Saving…">Save changes</Button>
                    </div>
                  </div>
                </Modal>
              </div>
            )
          })}
        </div>
      )}

      <Modal open={!!createVariantTarget} onClose={() => setCreateVariantTarget(null)} title={createVariantTarget ? `Add variant — ${createVariantTarget.name}` : 'Add variant'} className="w-[min(96vw,42rem)]">
        {createVariantTarget ? (
          <StoreProductForm
            product={{
              category: createVariantTarget.category_key,
              model_id: createVariantTarget.id,
              model_name: createVariantTarget.name,
              name: '',
              color: '',
              size: '',
              price_cents: 0,
              currency: 'EGP',
              inventory_qty: 0,
              is_active: true,
            }}
            onSaved={() => {
              const target = createVariantTarget
              setCreateVariantTarget(null)
              if (target) {
                void load()
                setExpandedModelId(target.id)
                void loadVariants(target.id, true)
                void loadUnlinkedQueue()
              }
              router.refresh()
            }}
            onCancel={() => setCreateVariantTarget(null)}
          />
        ) : null}
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => (isBusy ? null : setDeleteTarget(null))} title="Delete model?">
        <div className="space-y-4">
          <p className="text-sm text-[hsl(var(--muted))]">
            This will delete <span className="font-semibold text-black">{deleteTarget?.name}</span> only if no store product is still linked.
          </p>
          {deleteTarget && Number(deleteTarget.linked_product_count || 0) > 0 ? (
            <InlineAlert variant="warning">
              Delete blocked right now. {deleteTarget.linked_product_count} product(s) are still linked to this model.
            </InlineAlert>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)} disabled={isBusy}>Cancel</Button>
            <Button
              type="button"
              onClick={confirmDelete}
              loading={busyAction?.type === 'delete' && busyAction.id === deleteTarget?.id}
              loadingText="Deleting…"
              disabled={Number(deleteTarget?.linked_product_count || 0) > 0}
            >
              Delete model
            </Button>
          </div>
        </div>
      </Modal>

      <div className="rounded-2xl border border-dashed p-4 text-sm text-[hsl(var(--muted))]">
        Featured models: <span className="font-medium text-black">{featuredCount}</span>. Coverage now tracks linked vs unlinked variants, and the queue can suggest quick links to help finish the Store V3 migration before any future enforcement step.
      </div>
    </div>
  )
}
