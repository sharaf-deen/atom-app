export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import dynamicImport from 'next/dynamic'
import { redirect } from 'next/navigation'
import { getSessionUserCached, getSupabaseAdminClientCached } from '@/lib/requestCache'
import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedPage from '@/components/AccessDeniedPage'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/money'
import {
  canAccessStoreCatalogAdmin,
  canAccessStoreDashboard,
  canAccessStoreExpenses,
  canAccessStoreFunding,
  canManageStoreCatalog,
  canManageStorePreorders,
  canManageStoreSales,
  canManageStoreSupplierOrders,
} from '@/lib/rbac'
import AdminProductQuickEdit from '@/components/store/AdminProductQuickEdit'
import ProductImageStrip from '@/components/store/ProductImageStrip'
import StoreAdminNav from '@/components/store/StoreAdminNav'
import {
  FALLBACK_STORE_PRODUCT_CATEGORIES,
  buildStoreCategoryOptions,
  storeCategoryLabelMap,
  type StoreProductCategoryRow,
} from '@/lib/storeCategories'

const AdminStoreProductCreateForm = dynamicImport(() => import('@/components/store/AdminStoreProductCreateForm'), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-500">Loading quick product form…</div>,
})

const SupplierOrderForm = dynamicImport(() => import('@/components/store/SupplierOrderForm'), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-500">Loading supplier-order form…</div>,
})

const SupplierOrderHeaderEditor = dynamicImport(() => import('@/components/store/SupplierOrderHeaderEditor'), {
  ssr: false,
  loading: () => <div className="text-xs text-gray-500">Loading supplier-order editor…</div>,
})

const SupplierOrderReceiveLine = dynamicImport(() => import('@/components/store/SupplierOrderReceiveLine'), {
  ssr: false,
  loading: () => <div className="text-xs text-gray-500">Loading receive controls…</div>,
})

const StoreCategoryManager = dynamicImport(() => import('@/components/store/StoreCategoryManager'), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-500">Loading category manager…</div>,
})

type Category = string
type ActiveFilter = 'all' | 'active' | 'inactive'
type StockFilter = 'all' | 'in' | 'out' | 'low'
type PreorderFilter = 'all' | '1' | '0'
type SupplierStatusFilter = 'all' | 'draft' | 'ordered' | 'partially_received' | 'received' | 'canceled'
type SupplierReceivingFilter = 'all' | 'pending' | 'partial' | 'received' | 'draft'
type SupplierPeriodFilter = 'all' | 'month'
type Tab = 'catalog' | 'supplier-orders'

const STORE_PRODUCT_BUCKET = 'store-product-images'
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
const CATALOG_DEFAULT_PAGE_SIZE = 10
const CATALOG_PAGE_SIZE_OPTIONS = [10, 25, 50] as const

function storeProductImageUrl(path: string | null | undefined) {
  const clean = String(path ?? '').trim()
  if (!SUPABASE_URL || !clean) return ''
  const encodedPath = clean.split('/').map((segment) => encodeURIComponent(segment)).join('/')
  return `${SUPABASE_URL}/storage/v1/object/public/${STORE_PRODUCT_BUCKET}/${encodedPath}`
}

function resolveStoreProductImageUrl(path: string | null | undefined) {
  const clean = String(path ?? '').trim()
  if (!clean) return null
  if (/^https?:\/\//i.test(clean)) return clean
  return storeProductImageUrl(clean) || null
}

type ProductRow = {
  id: string
  category: Category
  model_id: string | null
  model: { id: string; name: string; slug: string | null; category_key: string | null } | null
  name: string
  color: string | null
  size: string | null
  price_cents: number
  currency: string | null
  inventory_qty: number
  is_active: boolean
  allow_preorder: boolean
  low_stock_threshold: number
  image_path: string | null
  image_path_2: string | null
  image_path_3: string | null
  created_at: string | null
}

type ProductQueryRow = Omit<ProductRow, 'model'> & {
  model:
    | ProductRow['model']
    | Array<NonNullable<ProductRow['model']>>
}

type ProductModelGroup = {
  key: string
  modelId: string | null
  modelName: string
  category: Category
  products: ProductRow[]
  representative: ProductRow
  totalStock: number
  lowStockCount: number
  outOfStockCount: number
  inactiveCount: number
  preorderCount: number
  minPriceCents: number
  maxPriceCents: number
  latestCreatedAt: string | null
}

type RestockSuggestion = {
  product: ProductRow
  status: 'out' | 'low' | 'preorder'
  suggestedQty: number
  targetStock: number
}

const RESTOCK_HELPER_LIMIT = 8

function normalizeProductRow(row: ProductQueryRow): ProductRow {
  const model = Array.isArray(row.model) ? row.model[0] ?? null : row.model ?? null
  return {
    ...row,
    model,
  }
}

type SupplierOrderItemRow = {
  id: string
  supplier_order_id: string
  product_id: string | null
  product_name: string
  product_category: Category | null
  product_color: string | null
  product_size: string | null
  unit_cost_cents: number
  ordered_qty: number
  received_qty: number
  line_total_cents: number
  line_status: 'ordered' | 'partially_received' | 'received' | 'canceled'
  created_at: string
  updated_at: string
}

type SupplierOrderRow = {
  id: string
  reference: string | null
  supplier_name: string | null
  status: 'draft' | 'ordered' | 'partially_received' | 'received' | 'canceled'
  notes: string | null
  ordered_at: string | null
  expected_at: string | null
  received_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  items?: SupplierOrderItemRow[] | null
}

type DashboardMetrics = {
  totalProducts: number
  activeProducts: number
  preorderEnabledProducts: number
  lowStockProducts: number
  outOfStockProducts: number
  totalUnits: number
  totalStockValueCents: number
  supplierOpenOrders: number
  supplierPartialOrders: number
  supplierReceivedOrders: number
  supplierPendingUnits: number
  supplierReceivedUnits: number
  supplierOrderedValueCents: number
}

type SupplierOrderTotals = {
  lineCount: number
  orderedQty: number
  receivedQty: number
  remainingQty: number
  totalCostCents: number
  receivedLineCount: number
  pendingLineCount: number
  progressPercent: number
}

type SupplierOrderHistoryMetrics = {
  trackedOrders: number
  estimatedSupplierTotalCents: number
  orderedUnits: number
  receivedUnits: number
  remainingUnits: number
  pendingReceiving: number
  partiallyReceived: number
  fullyReceived: number
  draftOrders: number
}


type StoreSalesOverviewRow = {
  status: string | null
  total_cents: number | null
  paid_cents: number | null
  debt_cents: number | null
  purchase_date: string | null
  created_at: string | null
}

type StorePreorderOverviewRow = {
  status: string | null
  total_cents: number | null
  deposit_cents: number | null
  balance_due_cents: number | null
  converted_sale_id: string | null
  created_at: string | null
  updated_at: string | null
}

type StoreExpenseOverviewRow = {
  expense_date: string | null
  amount_cents: number | null
  payment_method: string | null
  supplier_order_id: string | null
  attachment_path: string | null
  created_at: string | null
}

type StoreFundingOverviewRow = {
  funding_date: string | null
  type: string | null
  amount_cents: number | null
  attachment_path: string | null
  created_at: string | null
}

type StoreSalesOverviewMetrics = {
  trackedSales: number
  todaySales: number
  monthSales: number
  monthSoldCents: number
  monthCollectedCents: number
  outstandingDebtCents: number
  outstandingCount: number
}

type StorePreorderOverviewMetrics = {
  trackedPreorders: number
  openPreorders: number
  balanceDueCents: number
  balanceDueCount: number
  readyToComplete: number
  noDepositCount: number
}

type StoreExpenseOverviewMetrics = {
  trackedExpenses: number
  monthExpensesCents: number
  cashExpensesCents: number
  supplierLinkedCount: number
  missingProofCount: number
  withProofCount: number
}

type StoreFundingOverviewMetrics = {
  trackedFunding: number
  loanReceivedCents: number
  loanRepaidCents: number
  remainingToRepayCents: number
  missingProofCount: number
  withProofCount: number
}

const ACTIVE_FILTERS: Array<{ value: ActiveFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

const STOCK_FILTERS: Array<{ value: StockFilter; label: string }> = [
  { value: 'all', label: 'All stock' },
  { value: 'in', label: 'In stock' },
  { value: 'out', label: 'Out of stock' },
  { value: 'low', label: 'Low stock' },
]

const PREORDER_FILTERS: Array<{ value: PreorderFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: '1', label: 'Preorder enabled' },
  { value: '0', label: 'Preorder disabled' },
]

const SUPPLIER_STATUS_FILTERS: Array<{ value: SupplierStatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'ordered', label: 'Ordered' },
  { value: 'partially_received', label: 'Partially received' },
  { value: 'received', label: 'Received' },
  { value: 'canceled', label: 'Canceled' },
]

const SUPPLIER_RECEIVING_FILTERS: Array<{ value: SupplierReceivingFilter; label: string }> = [
  { value: 'all', label: 'All receiving' },
  { value: 'pending', label: 'Pending receiving' },
  { value: 'partial', label: 'Partially received' },
  { value: 'received', label: 'Fully received' },
  { value: 'draft', label: 'Draft only' },
]

const SUPPLIER_PERIOD_FILTERS: Array<{ value: SupplierPeriodFilter; label: string }> = [
  { value: 'all', label: 'All time' },
  { value: 'month', label: 'This month' },
]

function clampInt(v: unknown, def: number, min: number, max: number) {
  const raw = Array.isArray(v) ? v[0] : v
  const n = Number(raw)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.floor(n)))
}

function strParam(v: unknown) {
  const s = Array.isArray(v) ? v[0] : v
  return typeof s === 'string' ? s : ''
}

function normalizeTab(v: string): Tab {
  return v === 'supplier-orders' ? 'supplier-orders' : 'catalog'
}

function normalizeCategory(v: string, allowed: Set<string>): 'all' | Category {
  const clean = String(v || '').trim()
  return clean && allowed.has(clean) ? clean : 'all'
}

function normalizeActive(v: string): ActiveFilter {
  return v === 'active' || v === 'inactive' ? v : 'all'
}

function normalizeStock(v: string): StockFilter {
  return v === 'in' || v === 'out' || v === 'low' ? v : 'all'
}

function normalizePreorder(v: string): PreorderFilter {
  return v === '1' || v === '0' ? v : 'all'
}

function normalizeSupplierStatus(v: string): SupplierStatusFilter {
  return v === 'draft' || v === 'ordered' || v === 'partially_received' || v === 'received' || v === 'canceled' ? v : 'all'
}

function normalizeSupplierReceiving(v: string): SupplierReceivingFilter {
  return v === 'pending' || v === 'partial' || v === 'received' || v === 'draft' ? v : 'all'
}

function normalizeSupplierPeriod(v: string): SupplierPeriodFilter {
  return v === 'month' ? 'month' : 'all'
}

function buildUrl(base: string, params: Record<string, string>) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v)
  const s = qs.toString()
  return s ? `${base}?${s}` : base
}

function shortId(id: string) {
  return (id || '').slice(0, 8)
}

function productModelGroupLabel(product: ProductRow) {
  const modelName = String(product.model?.name ?? '').trim()
  if (modelName) return modelName
  const productName = String(product.name ?? '').trim()
  return productName || `Product ${shortId(product.id)}`
}

function formatVariantLabel(product: ProductRow) {
  const parts = [product.color, product.size].map((value) => String(value ?? '').trim()).filter(Boolean)
  if (parts.length > 0) return parts.join(' / ')
  return product.name || 'Default variant'
}

function groupProductsByModel(products: ProductRow[]): ProductModelGroup[] {
  const groups = new Map<string, ProductModelGroup>()

  for (const product of products) {
    const key = product.model_id ? `model:${product.model_id}` : `product:${product.id}`
    const createdAt = product.created_at ?? null
    const existing = groups.get(key)

    if (!existing) {
      groups.set(key, {
        key,
        modelId: product.model_id,
        modelName: productModelGroupLabel(product),
        category: product.category,
        products: [product],
        representative: product,
        totalStock: Math.max(0, Number(product.inventory_qty ?? 0)),
        lowStockCount: isLowStock(product) ? 1 : 0,
        outOfStockCount: Math.max(0, Number(product.inventory_qty ?? 0)) <= 0 ? 1 : 0,
        inactiveCount: product.is_active ? 0 : 1,
        preorderCount: product.allow_preorder ? 1 : 0,
        minPriceCents: Math.max(0, Number(product.price_cents ?? 0)),
        maxPriceCents: Math.max(0, Number(product.price_cents ?? 0)),
        latestCreatedAt: createdAt,
      })
      continue
    }

    const price = Math.max(0, Number(product.price_cents ?? 0))
    existing.products.push(product)
    existing.totalStock += Math.max(0, Number(product.inventory_qty ?? 0))
    existing.lowStockCount += isLowStock(product) ? 1 : 0
    existing.outOfStockCount += Math.max(0, Number(product.inventory_qty ?? 0)) <= 0 ? 1 : 0
    existing.inactiveCount += product.is_active ? 0 : 1
    existing.preorderCount += product.allow_preorder ? 1 : 0
    existing.minPriceCents = Math.min(existing.minPriceCents, price)
    existing.maxPriceCents = Math.max(existing.maxPriceCents, price)

    if (createdAt && (!existing.latestCreatedAt || new Date(createdAt).getTime() > new Date(existing.latestCreatedAt).getTime())) {
      existing.latestCreatedAt = createdAt
      existing.representative = product
    }
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    products: group.products.sort((a, b) => {
      const colorCompare = String(a.color ?? '').localeCompare(String(b.color ?? ''))
      if (colorCompare !== 0) return colorCompare
      const sizeCompare = String(a.size ?? '').localeCompare(String(b.size ?? ''), undefined, { numeric: true })
      if (sizeCompare !== 0) return sizeCompare
      return String(a.name ?? '').localeCompare(String(b.name ?? ''))
    }),
  }))
}

function groupStockPill(group: Pick<ProductModelGroup, 'totalStock' | 'lowStockCount' | 'outOfStockCount'>) {
  if (group.totalStock <= 0 || group.outOfStockCount > 0) {
    return <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">{group.outOfStockCount} out of stock</span>
  }
  if (group.lowStockCount > 0) {
    return <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">{group.lowStockCount} low stock</span>
  }
  return <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Healthy model</span>
}

function priceRangeLabel(group: Pick<ProductModelGroup, 'minPriceCents' | 'maxPriceCents'>, currency: string | null | undefined) {
  if (group.minPriceCents === group.maxPriceCents) return formatCurrency(group.minPriceCents, 'en-EG', currency ?? 'EGP')
  return `${formatCurrency(group.minPriceCents, 'en-EG', currency ?? 'EGP')} – ${formatCurrency(group.maxPriceCents, 'en-EG', currency ?? 'EGP')}`
}

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10)
}


function safeCents(value: unknown) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
}

function safeDate(value?: string | null) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function isSameCalendarDay(value?: string | null, now = new Date()) {
  const d = safeDate(value)
  if (!d) return false
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

function isSameCalendarMonth(value?: string | null, now = new Date()) {
  const d = safeDate(value)
  if (!d) return false
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

function proofAttached(row: { attachment_path?: string | null }) {
  return Boolean(String(row.attachment_path ?? '').trim())
}

function isLowStock(product: Pick<ProductRow, 'inventory_qty' | 'low_stock_threshold'>) {
  const qty = Math.max(0, Number(product.inventory_qty ?? 0))
  const threshold = Math.max(0, Number(product.low_stock_threshold ?? 0))
  if (qty <= 0) return true
  return threshold > 0 && qty <= threshold
}

function stockPill(product: Pick<ProductRow, 'inventory_qty' | 'low_stock_threshold'>) {
  const qty = Math.max(0, Number(product.inventory_qty ?? 0))
  const threshold = Math.max(0, Number(product.low_stock_threshold ?? 0))

  if (qty <= 0) {
    return <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">Out of stock</span>
  }
  if (threshold > 0 && qty <= threshold) {
    return <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">Low stock</span>
  }
  return <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Healthy stock</span>
}

function restockStatus(product: ProductRow): RestockSuggestion['status'] | null {
  const qty = Math.max(0, Number(product.inventory_qty ?? 0))
  const threshold = Math.max(0, Number(product.low_stock_threshold ?? 0))

  if (qty <= 0) return 'out'
  if (threshold > 0 && qty <= threshold) return 'low'
  if (product.allow_preorder) return 'preorder'
  return null
}

function restockStatusPill(status: RestockSuggestion['status']) {
  if (status === 'out') {
    return <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">Out of stock</span>
  }
  if (status === 'low') {
    return <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">Low stock</span>
  }
  return <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">Preorder</span>
}

function suggestedRestock(product: ProductRow) {
  const qty = Math.max(0, Number(product.inventory_qty ?? 0))
  const threshold = Math.max(0, Number(product.low_stock_threshold ?? 0))
  const targetStock = threshold > 0 ? Math.max(threshold * 2, qty + 5, 5) : Math.max(qty + 5, 5)

  return {
    suggestedQty: Math.max(1, targetStock - qty),
    targetStock,
  }
}

function buildRestockSuggestions(products: ProductRow[]): RestockSuggestion[] {
  return products
    .filter((product) => product.is_active)
    .map((product) => {
      const status = restockStatus(product)
      if (!status) return null
      const restock = suggestedRestock(product)
      return {
        product,
        status,
        suggestedQty: restock.suggestedQty,
        targetStock: restock.targetStock,
      }
    })
    .filter((suggestion): suggestion is RestockSuggestion => suggestion !== null)
    .sort((a, b) => {
      const priority = { out: 0, low: 1, preorder: 2 } satisfies Record<RestockSuggestion['status'], number>
      const priorityDiff = priority[a.status] - priority[b.status]
      if (priorityDiff !== 0) return priorityDiff

      const stockDiff = Math.max(0, Number(a.product.inventory_qty ?? 0)) - Math.max(0, Number(b.product.inventory_qty ?? 0))
      if (stockDiff !== 0) return stockDiff

      const modelDiff = productModelGroupLabel(a.product).localeCompare(productModelGroupLabel(b.product))
      if (modelDiff !== 0) return modelDiff

      return formatVariantLabel(a.product).localeCompare(formatVariantLabel(b.product), undefined, { numeric: true })
    })
}

function supplierStatusPill(status: SupplierOrderRow['status']) {
  switch (status) {
    case 'draft':
      return <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">Draft</span>
    case 'ordered':
      return <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">Ordered</span>
    case 'partially_received':
      return <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">Partially received</span>
    case 'received':
      return <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Received</span>
    case 'canceled':
      return <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">Canceled</span>
  }
}

function supplierLinePill(status: SupplierOrderItemRow['line_status']) {
  switch (status) {
    case 'ordered':
      return <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">Ordered</span>
    case 'partially_received':
      return <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">Partial</span>
    case 'received':
      return <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Received</span>
    case 'canceled':
      return <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">Canceled</span>
  }
}

function computeSupplierOrderTotals(order: SupplierOrderRow): SupplierOrderTotals {
  const items = order.items ?? []
  const orderedQty = items.reduce((sum, item) => sum + Math.max(0, Number(item.ordered_qty ?? 0)), 0)
  const receivedQty = items.reduce((sum, item) => sum + Math.max(0, Number(item.received_qty ?? 0)), 0)
  const remainingQty = Math.max(0, orderedQty - receivedQty)
  const totalCostCents = items.reduce((sum, item) => sum + Math.max(0, Number(item.line_total_cents ?? 0)), 0)
  const receivedLineCount = items.filter((item) => Math.max(0, Number(item.ordered_qty ?? 0) - Number(item.received_qty ?? 0)) <= 0 && Math.max(0, Number(item.ordered_qty ?? 0)) > 0).length
  const pendingLineCount = items.filter((item) => Math.max(0, Number(item.ordered_qty ?? 0) - Number(item.received_qty ?? 0)) > 0).length
  const progressPercent = orderedQty > 0 ? Math.min(100, Math.max(0, Math.round((receivedQty / orderedQty) * 100))) : order.status === 'received' ? 100 : 0

  return {
    lineCount: items.length,
    orderedQty,
    receivedQty,
    remainingQty,
    totalCostCents,
    receivedLineCount,
    pendingLineCount,
    progressPercent,
  }
}

function supplierOrderReceivingLabel(order: SupplierOrderRow, totals = computeSupplierOrderTotals(order)) {
  if (order.status === 'canceled') return 'Canceled'
  if (order.status === 'draft') return 'Draft'
  if (totals.lineCount === 0) return 'No lines'
  if (totals.remainingQty <= 0 && totals.receivedQty > 0) return 'Fully received'
  if (totals.receivedQty > 0 && totals.remainingQty > 0) return 'Partially received'
  if (totals.remainingQty > 0) return 'Pending receiving'
  return order.status === 'received' ? 'Fully received' : 'Pending receiving'
}

function supplierReceivingPill(order: SupplierOrderRow, totals = computeSupplierOrderTotals(order)) {
  const label = supplierOrderReceivingLabel(order, totals)
  if (label === 'Fully received') {
    return <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Fully received</span>
  }
  if (label === 'Partially received') {
    return <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">Receiving in progress</span>
  }
  if (label === 'Pending receiving') {
    return <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">Pending receiving</span>
  }
  if (label === 'Draft') {
    return <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">Draft</span>
  }
  if (label === 'Canceled') {
    return <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">Canceled</span>
  }
  return <span className="rounded-full border px-2.5 py-1 text-xs font-medium text-[hsl(var(--muted))]">No lines</span>
}

function supplierOrderToneClass(order: SupplierOrderRow, totals = computeSupplierOrderTotals(order)) {
  if (order.status === 'canceled') return 'border-rose-200 bg-rose-50/40'
  if (order.status === 'draft') return 'border-slate-200 bg-slate-50/50'
  if (totals.remainingQty <= 0 && totals.receivedQty > 0) return 'border-emerald-200 bg-emerald-50/40'
  if (totals.receivedQty > 0 && totals.remainingQty > 0) return 'border-amber-200 bg-amber-50/40'
  if (totals.remainingQty > 0) return 'border-sky-200 bg-sky-50/40'
  return 'bg-[hsl(var(--card))]'
}

function supplierOrderMatchesReceivingFilter(order: SupplierOrderRow, filter: SupplierReceivingFilter) {
  if (filter === 'all') return true
  const totals = computeSupplierOrderTotals(order)
  if (filter === 'draft') return order.status === 'draft'
  if (filter === 'received') return order.status === 'received' || (totals.remainingQty <= 0 && totals.receivedQty > 0)
  if (filter === 'partial') return order.status === 'partially_received' || (totals.receivedQty > 0 && totals.remainingQty > 0)
  if (filter === 'pending') {
    if (order.status === 'draft' || order.status === 'canceled' || order.status === 'received') return false
    return totals.remainingQty > 0 || order.status === 'ordered' || order.status === 'partially_received'
  }
  return true
}

function supplierOrderMatchesPeriodFilter(order: SupplierOrderRow, filter: SupplierPeriodFilter) {
  if (filter === 'all') return true
  const dateValue = order.ordered_at || order.created_at
  if (!dateValue) return false
  const d = new Date(dateValue)
  if (Number.isNaN(d.getTime())) return false
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

function computeSupplierOrderHistoryMetrics(orders: SupplierOrderRow[]): SupplierOrderHistoryMetrics {
  return orders.reduce((acc, order) => {
    const totals = computeSupplierOrderTotals(order)
    acc.trackedOrders += 1
    acc.estimatedSupplierTotalCents += totals.totalCostCents
    acc.orderedUnits += totals.orderedQty
    acc.receivedUnits += totals.receivedQty
    acc.remainingUnits += totals.remainingQty
    if (order.status === 'draft') acc.draftOrders += 1
    if (supplierOrderMatchesReceivingFilter(order, 'pending')) acc.pendingReceiving += 1
    if (supplierOrderMatchesReceivingFilter(order, 'partial')) acc.partiallyReceived += 1
    if (supplierOrderMatchesReceivingFilter(order, 'received')) acc.fullyReceived += 1
    return acc
  }, {
    trackedOrders: 0,
    estimatedSupplierTotalCents: 0,
    orderedUnits: 0,
    receivedUnits: 0,
    remainingUnits: 0,
    pendingReceiving: 0,
    partiallyReceived: 0,
    fullyReceived: 0,
    draftOrders: 0,
  })
}


function computeSalesOverviewMetrics(rows: StoreSalesOverviewRow[]): StoreSalesOverviewMetrics {
  const now = new Date()
  return rows.reduce((acc, row) => {
    const dateValue = row.purchase_date || row.created_at
    const debtCents = safeCents(row.debt_cents)
    acc.trackedSales += 1
    if (isSameCalendarDay(dateValue, now)) acc.todaySales += 1
    if (isSameCalendarMonth(dateValue, now)) {
      acc.monthSales += 1
      acc.monthSoldCents += safeCents(row.total_cents)
      acc.monthCollectedCents += safeCents(row.paid_cents)
    }
    if (debtCents > 0 && row.status !== 'canceled') {
      acc.outstandingDebtCents += debtCents
      acc.outstandingCount += 1
    }
    return acc
  }, {
    trackedSales: 0,
    todaySales: 0,
    monthSales: 0,
    monthSoldCents: 0,
    monthCollectedCents: 0,
    outstandingDebtCents: 0,
    outstandingCount: 0,
  })
}

function computePreorderOverviewMetrics(rows: StorePreorderOverviewRow[]): StorePreorderOverviewMetrics {
  return rows.reduce((acc, row) => {
    const status = String(row.status ?? '')
    const balanceCents = safeCents(row.balance_due_cents)
    const isClosed = status === 'completed' || status === 'canceled' || Boolean(row.converted_sale_id)
    acc.trackedPreorders += 1
    if (!isClosed) acc.openPreorders += 1
    if (!isClosed && balanceCents > 0) {
      acc.balanceDueCents += balanceCents
      acc.balanceDueCount += 1
    }
    if (!isClosed && safeCents(row.deposit_cents) <= 0) acc.noDepositCount += 1
    if (!isClosed && status === 'ready') acc.readyToComplete += 1
    return acc
  }, {
    trackedPreorders: 0,
    openPreorders: 0,
    balanceDueCents: 0,
    balanceDueCount: 0,
    readyToComplete: 0,
    noDepositCount: 0,
  })
}

function computeExpenseOverviewMetrics(rows: StoreExpenseOverviewRow[]): StoreExpenseOverviewMetrics {
  const now = new Date()
  return rows.reduce((acc, row) => {
    const amountCents = safeCents(row.amount_cents)
    acc.trackedExpenses += 1
    if (isSameCalendarMonth(row.expense_date || row.created_at, now)) acc.monthExpensesCents += amountCents
    if (row.payment_method === 'cash') acc.cashExpensesCents += amountCents
    if (row.supplier_order_id) acc.supplierLinkedCount += 1
    if (proofAttached(row)) acc.withProofCount += 1
    else acc.missingProofCount += 1
    return acc
  }, {
    trackedExpenses: 0,
    monthExpensesCents: 0,
    cashExpensesCents: 0,
    supplierLinkedCount: 0,
    missingProofCount: 0,
    withProofCount: 0,
  })
}

function computeFundingOverviewMetrics(rows: StoreFundingOverviewRow[]): StoreFundingOverviewMetrics {
  return rows.reduce((acc, row) => {
    const amountCents = safeCents(row.amount_cents)
    acc.trackedFunding += 1
    if (row.type === 'loan_repayment') acc.loanRepaidCents += amountCents
    else if (row.type === 'loan_received') acc.loanReceivedCents += amountCents
    if (proofAttached(row)) acc.withProofCount += 1
    else acc.missingProofCount += 1
    acc.remainingToRepayCents = Math.max(0, acc.loanReceivedCents - acc.loanRepaidCents)
    return acc
  }, {
    trackedFunding: 0,
    loanReceivedCents: 0,
    loanRepaidCents: 0,
    remainingToRepayCents: 0,
    missingProofCount: 0,
    withProofCount: 0,
  })
}

function computeMetrics(products: ProductRow[], supplierOrders: SupplierOrderRow[]): DashboardMetrics {
  const productMetrics = products.reduce(
    (acc, product) => {
      const qty = Math.max(0, Number(product.inventory_qty ?? 0))
      const price = Math.max(0, Number(product.price_cents ?? 0))
      acc.totalProducts += 1
      if (product.is_active) acc.activeProducts += 1
      if (product.allow_preorder) acc.preorderEnabledProducts += 1
      if (isLowStock(product)) acc.lowStockProducts += 1
      if (qty <= 0) acc.outOfStockProducts += 1
      acc.totalUnits += qty
      acc.totalStockValueCents += qty * price
      return acc
    },
    {
      totalProducts: 0,
      activeProducts: 0,
      preorderEnabledProducts: 0,
      lowStockProducts: 0,
      outOfStockProducts: 0,
      totalUnits: 0,
      totalStockValueCents: 0,
      supplierOpenOrders: 0,
      supplierPartialOrders: 0,
      supplierReceivedOrders: 0,
      supplierPendingUnits: 0,
      supplierReceivedUnits: 0,
      supplierOrderedValueCents: 0,
    } as DashboardMetrics
  )

  for (const order of supplierOrders) {
    if (order.status === 'draft' || order.status === 'ordered') productMetrics.supplierOpenOrders += 1
    if (order.status === 'partially_received') productMetrics.supplierPartialOrders += 1
    if (order.status === 'received') productMetrics.supplierReceivedOrders += 1
    for (const item of order.items ?? []) {
      const orderedQty = Math.max(0, Number(item.ordered_qty ?? 0))
      const receivedQty = Math.max(0, Number(item.received_qty ?? 0))
      productMetrics.supplierPendingUnits += Math.max(0, orderedQty - receivedQty)
      productMetrics.supplierReceivedUnits += receivedQty
      productMetrics.supplierOrderedValueCents += Math.max(0, Number(item.line_total_cents ?? 0))
    }
  }

  return productMetrics
}

export default async function AdminStorePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const me = await getSessionUserCached()
  if (!me) redirect('/login?next=/admin/store')

  if (!canAccessStoreCatalogAdmin(me.role)) {
    return (
      <AccessDeniedPage
        title="Store Admin"
        subtitle="Access restricted."
        signedInAs={me.email}
        message="This page is for reception, admin, and super admin. Catalog access is read-only except for super admin."
        allowed="reception, admin, super_admin"
        nextPath="/admin/store"
        actions={[{ href: '/store', label: 'Go to Store' }]}
        showBackHome
      />
    )
  }

  const requestedTab = strParam(searchParams?.tab)
  if (requestedTab === 'dashboard') redirect('/admin/store/dashboard')
  const tab = normalizeTab(requestedTab)
  if (tab === 'supplier-orders' && !canManageStoreSupplierOrders(me.role)) redirect('/admin/store')
  const page = clampInt(searchParams?.page, 1, 1, 9999)
  const pageSize = clampInt(searchParams?.page_size, CATALOG_DEFAULT_PAGE_SIZE, 10, 50)
  const q = strParam(searchParams?.q).trim()
  const active = normalizeActive(strParam(searchParams?.active))
  const stock = normalizeStock(strParam(searchParams?.stock))
  const preorder = normalizePreorder(strParam(searchParams?.preorder))

  const supplierPage = clampInt(searchParams?.s_page, 1, 1, 9999)
  const supplierPageSize = clampInt(searchParams?.s_page_size, 10, 5, 30)
  const supplierQ = strParam(searchParams?.s_q).trim()
  const supplierStatus = normalizeSupplierStatus(strParam(searchParams?.s_status))
  const supplierReceiving = normalizeSupplierReceiving(strParam(searchParams?.s_receiving))
  const supplierPeriod = normalizeSupplierPeriod(strParam(searchParams?.s_period))

  const supa = getSupabaseAdminClientCached()

  let categoryRows: StoreProductCategoryRow[] = []
  try {
    const { data, error } = await supa
      .from('store_product_categories')
      .select('key,label,is_active,sort_order')
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true })
    if (error) throw error
    categoryRows = ((data ?? []) as StoreProductCategoryRow[]).filter((row) => row.key && row.label)
  } catch {
    categoryRows = FALLBACK_STORE_PRODUCT_CATEGORIES
  }

  if (categoryRows.length === 0) categoryRows = FALLBACK_STORE_PRODUCT_CATEGORIES
  const activeCategoryRows = categoryRows.filter((row) => row.is_active)
  const categoryKeys = new Set(activeCategoryRows.map((row) => row.key))
  const category = normalizeCategory(strParam(searchParams?.category), categoryKeys)
  const categoryOptions = buildStoreCategoryOptions(activeCategoryRows, { includeAll: true })
  const categoryLabels = storeCategoryLabelMap(categoryRows)

  let productsError: string | null = null
  let supplierError: string | null = null
  let allProducts: ProductRow[] = []
  let supplierOrders: SupplierOrderRow[] = []

  try {
    let productQuery = supa
.from('store_products')
      .select('id, category, model_id, model:store_product_models(id,name,slug,category_key), name, color, size, price_cents, currency, inventory_qty, is_active, allow_preorder, low_stock_threshold, image_path, image_path_2, image_path_3, created_at')
      .order('created_at', { ascending: false })
      .limit(1000)

    if (category !== 'all') productQuery = productQuery.eq('category', category)
    if (active === 'active') productQuery = productQuery.eq('is_active', true)
    if (active === 'inactive') productQuery = productQuery.eq('is_active', false)
    if (preorder === '1') productQuery = productQuery.eq('allow_preorder', true)
    if (preorder === '0') productQuery = productQuery.eq('allow_preorder', false)
    const { data, error } = await productQuery
    if (error) throw new Error(error.message)
    allProducts = (Array.isArray(data) ? (data as ProductQueryRow[]).map(normalizeProductRow) : [])
  } catch (error: any) {
    productsError = error?.message || String(error)
  }

  try {
    let supplierQuery = supa
      .from('store_supplier_orders')
      .select(
        'id, reference, supplier_name, status, notes, ordered_at, expected_at, received_at, created_at, updated_at, created_by, updated_by, items:store_supplier_order_items(id, supplier_order_id, product_id, product_name, product_category, product_color, product_size, unit_cost_cents, ordered_qty, received_qty, line_total_cents, line_status, created_at, updated_at)'
      )
      .order('created_at', { ascending: false })
      .limit(200)

    if (supplierStatus !== 'all') supplierQuery = supplierQuery.eq('status', supplierStatus)
    if (supplierQ) {
      const safe = supplierQ.replace(/,/g, ' ').trim()
      supplierQuery = supplierQuery.or(`reference.ilike.%${safe}%,supplier_name.ilike.%${safe}%`)
    }

    const { data, error } = await supplierQuery
    if (error) throw new Error(error.message)
    supplierOrders = (Array.isArray(data) ? data : []) as SupplierOrderRow[]
  } catch (error: any) {
    supplierError = error?.message || String(error)
  }

  let salesOverview = computeSalesOverviewMetrics([])
  let preorderOverview = computePreorderOverviewMetrics([])
  let expenseOverview = computeExpenseOverviewMetrics([])
  let fundingOverview = computeFundingOverviewMetrics([])
  let supplierOverviewOrders: SupplierOrderRow[] = []

  try {
    const { data, error } = await supa
      .from('store_sales')
      .select('status,total_cents,paid_cents,debt_cents,purchase_date,created_at')
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) throw new Error(error.message)
    salesOverview = computeSalesOverviewMetrics((Array.isArray(data) ? data : []) as StoreSalesOverviewRow[])
  } catch {
    salesOverview = computeSalesOverviewMetrics([])
  }

  try {
    const { data, error } = await supa
      .from('store_preorders')
      .select('status,total_cents,deposit_cents,balance_due_cents,converted_sale_id,created_at,updated_at')
      .order('created_at', { ascending: false })
      .limit(1000)
    if (error) throw new Error(error.message)
    preorderOverview = computePreorderOverviewMetrics((Array.isArray(data) ? data : []) as StorePreorderOverviewRow[])
  } catch {
    preorderOverview = computePreorderOverviewMetrics([])
  }

  try {
    const { data, error } = await supa
      .from('store_supplier_orders')
      .select(
        'id, reference, supplier_name, status, notes, ordered_at, expected_at, received_at, created_at, updated_at, created_by, updated_by, items:store_supplier_order_items(id, supplier_order_id, product_id, product_name, product_category, product_color, product_size, unit_cost_cents, ordered_qty, received_qty, line_total_cents, line_status, created_at, updated_at)'
      )
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw new Error(error.message)
    supplierOverviewOrders = (Array.isArray(data) ? data : []) as SupplierOrderRow[]
  } catch {
    supplierOverviewOrders = []
  }

  try {
    const { data, error } = await supa
      .from('store_expenses')
      .select('expense_date,amount_cents,payment_method,supplier_order_id,attachment_path,created_at')
      .order('expense_date', { ascending: false })
      .limit(1000)
    if (error) throw new Error(error.message)
    expenseOverview = computeExpenseOverviewMetrics((Array.isArray(data) ? data : []) as StoreExpenseOverviewRow[])
  } catch {
    expenseOverview = computeExpenseOverviewMetrics([])
  }

  try {
    const { data, error } = await supa
      .from('store_external_funding')
      .select('funding_date,type,amount_cents,attachment_path,created_at')
      .order('funding_date', { ascending: false })
      .limit(1000)
    if (error) throw new Error(error.message)
    fundingOverview = computeFundingOverviewMetrics((Array.isArray(data) ? data : []) as StoreFundingOverviewRow[])
  } catch {
    fundingOverview = computeFundingOverviewMetrics([])
  }

  const supplierOverview = computeSupplierOrderHistoryMetrics(supplierOverviewOrders)

  const normalizedProductSearch = q.toLowerCase()
  const filteredProducts = !productsError
    ? allProducts.filter((product) => {
        const qty = Math.max(0, Number(product.inventory_qty ?? 0))
        if (stock === 'in' && qty <= 0) return false
        if (stock === 'out' && qty > 0) return false
        if (stock === 'low' && !isLowStock(product)) return false
        if (normalizedProductSearch) {
          const haystack = [
            product.name,
            product.model?.name,
            product.category,
            categoryLabels.get(product.category),
            product.color,
            product.size,
            shortId(product.id),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
          if (!haystack.includes(normalizedProductSearch)) return false
        }
        return true
      })
    : []

  const productById = new Map(allProducts.map((product) => [product.id, product]))
  const groupedProducts = groupProductsByModel(filteredProducts)
  const metrics = computeMetrics(allProducts, supplierOrders)
  const restockSuggestions = buildRestockSuggestions(allProducts)
  const visibleRestockSuggestions = restockSuggestions.slice(0, RESTOCK_HELPER_LIMIT)
  const urgentRestockCount = restockSuggestions.filter((suggestion) => suggestion.status === 'out' || suggestion.status === 'low').length
  const preorderRestockCount = restockSuggestions.filter((suggestion) => suggestion.status === 'preorder').length
  const totalFilteredProducts = filteredProducts.length
  const totalFilteredGroups = groupedProducts.length
  const totalProductPages = Math.max(1, Math.ceil(totalFilteredGroups / pageSize))
  const safeProductPage = Math.min(page, totalProductPages)
  const productStart = (safeProductPage - 1) * pageSize
  const pagedProductGroups = groupedProducts.slice(productStart, productStart + pageSize)
  const shownProductCount = pagedProductGroups.reduce((sum, group) => sum + group.products.length, 0)
  const hasMoreProducts = safeProductPage < totalProductPages

  const filteredSupplierOrders = supplierOrders.filter((order) => {
    if (!supplierOrderMatchesReceivingFilter(order, supplierReceiving)) return false
    if (!supplierOrderMatchesPeriodFilter(order, supplierPeriod)) return false
    return true
  })
  const supplierHistoryMetrics = computeSupplierOrderHistoryMetrics(filteredSupplierOrders)
  const totalSupplierOrders = filteredSupplierOrders.length
  const totalSupplierPages = Math.max(1, Math.ceil(totalSupplierOrders / supplierPageSize))
  const safeSupplierPage = Math.min(supplierPage, totalSupplierPages)
  const supplierStart = (safeSupplierPage - 1) * supplierPageSize
  const pagedSupplierOrders = filteredSupplierOrders.slice(supplierStart, supplierStart + supplierPageSize)
  const hasMoreSupplierOrders = safeSupplierPage < totalSupplierPages

  const catalogBaseParams = {
    tab: 'catalog',
    q,
    category: category === 'all' ? '' : category,
    active: active === 'all' ? '' : active,
    stock: stock === 'all' ? '' : stock,
    preorder: preorder === 'all' ? '' : preorder,
    page_size: pageSize === CATALOG_DEFAULT_PAGE_SIZE ? '' : String(pageSize),
  }

  const supplierBaseParams = {
    tab: 'supplier-orders',
    s_q: supplierQ,
    s_status: supplierStatus === 'all' ? '' : supplierStatus,
    s_receiving: supplierReceiving === 'all' ? '' : supplierReceiving,
    s_period: supplierPeriod === 'all' ? '' : supplierPeriod,
    s_page_size: String(supplierPageSize),
  }

  const variantSourceProductId = strParam(searchParams?.variant_from).trim()
  const variantSourceProduct = variantSourceProductId
    ? allProducts.find((product) => product.id === variantSourceProductId) ?? null
    : null
  const variantFallbackPriceCents = Number(strParam(searchParams?.variant_price_cents))
  const initialVariant = variantSourceProductId
    ? {
        sourceProductId: variantSourceProductId,
        category: variantSourceProduct?.category ?? strParam(searchParams?.variant_category).trim(),
        modelId: variantSourceProduct?.model_id ?? strParam(searchParams?.variant_model_id).trim(),
        modelName: variantSourceProduct?.model?.name ?? (strParam(searchParams?.variant_model_name).trim() || null),
        priceCents: variantSourceProduct?.price_cents ?? (Number.isFinite(variantFallbackPriceCents) && variantFallbackPriceCents > 0 ? Math.floor(variantFallbackPriceCents) : null),
      }
    : null

  const canSeeDashboard = canAccessStoreDashboard(me.role)
  const canSeeExpenses = canAccessStoreExpenses(me.role)
  const canSeeFunding = canAccessStoreFunding(me.role)
  const storeExpenseLinkTo = todayDateOnly()
  const canManageCatalog = canManageStoreCatalog(me.role)
  const canManageSupplierOrders = canManageStoreSupplierOrders(me.role)
  const canManagePreorders = canManageStorePreorders(me.role)
  const canManageSales = canManageStoreSales(me.role)

  return (
    <main>
      <PageHeader
        title="Store Admin"
        subtitle="Store V3 — operational hub with role-based access."
        right={
          <div className="flex flex-wrap items-center gap-2">
            {canSeeDashboard ? (
              <Link
                prefetch={false}
                href="/admin/store/dashboard"
                className="inline-flex items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50"
              >
                Open dashboard
              </Link>
            ) : null}
            {canManageCatalog ? (
              <Link
                prefetch={false}
                href="/admin/store/models"
                className="inline-flex items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50"
              >
                Open models
              </Link>
            ) : null}
            {canManagePreorders ? (
              <Link
                prefetch={false}
                href="/admin/store/preorders"
                className="inline-flex items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50"
              >
                Open preorders
              </Link>
            ) : null}
            {canManageSales ? (
              <Link
                prefetch={false}
                href="/admin/store/sales"
                className="inline-flex items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50"
              >
                Open sales
              </Link>
            ) : null}
            <Link
              prefetch={false}
              href="/store"
              className="inline-flex items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Open /store
            </Link>
          </div>
        }
      />

      <Section className="space-y-4">
        <StoreAdminNav current={tab === 'supplier-orders' ? '/admin/store?tab=supplier-orders' : '/admin/store'} role={me.role} />
      </Section>

      <Section className="space-y-4">
        <Card>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {canSeeDashboard ? (
              <Link href="/admin/store/dashboard" className="rounded-2xl border bg-white p-4 transition hover:bg-gray-50">
                <div className="text-sm font-semibold">Dashboard</div>
                <div className="mt-1 text-xs text-[hsl(var(--muted))]">Open the dedicated business summary.</div>
              </Link>
            ) : null}
            <Link href="/admin/store?tab=catalog" className="rounded-2xl border bg-white p-4 transition hover:bg-gray-50">
              <div className="text-sm font-semibold">Catalog & Stock</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">{canManageCatalog ? 'Manage active products, stock, and preorder flags.' : 'Read-only catalog and stock visibility for your role.'}</div>
            </Link>
            {canManageCatalog ? (
              <Link href="/admin/store/models" className="rounded-2xl border bg-white p-4 transition hover:bg-gray-50">
                <div className="text-sm font-semibold">Models</div>
                <div className="mt-1 text-xs text-[hsl(var(--muted))]">Create parent catalog models for the future model → color → size flow.</div>
              </Link>
            ) : null}
            {canManageSupplierOrders ? (
              <Link href="/admin/store?tab=supplier-orders" className="rounded-2xl border bg-white p-4 transition hover:bg-gray-50">
                <div className="text-sm font-semibold">Supplier Orders</div>
                <div className="mt-1 text-xs text-[hsl(var(--muted))]">Create orders and receive stock by delta.</div>
              </Link>
            ) : null}
            {canSeeExpenses ? (
              <Link href="/admin/store/expenses" className="rounded-2xl border bg-white p-4 transition hover:bg-gray-50">
                <div className="text-sm font-semibold">Expenses</div>
                <div className="mt-1 text-xs text-[hsl(var(--muted))]">Track supplier, transport, and store costs.</div>
              </Link>
            ) : null}
            <div className="rounded-2xl border bg-white p-3">
              <div className="text-sm font-semibold">Store V3 hub</div>
              <div className="mt-1 text-xs text-[hsl(var(--muted))]">{canManageCatalog ? 'Full catalog controls stay on super admin. Preorders and sales remain separated.' : 'Preorders, supplier orders, sales, and catalog changes stay restricted to super admin.'}</div>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-slate-200">
          <CardHeader className="border-b bg-slate-50/70">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-lg">Store overview</CardTitle>
                <div className="mt-1 text-xs text-[hsl(var(--muted))]">A read-only snapshot of stock, sales, preorders, supplier receiving, expenses, and funding.</div>
              </div>
              <span className="rounded-full border bg-white px-3 py-1 text-xs font-medium text-[hsl(var(--muted))]">No automatic changes</span>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Link href={buildUrl('/admin/store', { tab: 'catalog', stock: metrics.outOfStockProducts > 0 ? 'out' : 'low' })} className="rounded-2xl border bg-white p-4 transition hover:bg-gray-50">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Stock attention</div>
                  <div className="mt-1 text-xs text-[hsl(var(--muted))]">Low/out variants and preorder-enabled products.</div>
                </div>
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">{metrics.lowStockProducts + metrics.outOfStockProducts}</span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-xl bg-slate-50 p-2"><div className="font-semibold">{metrics.lowStockProducts}</div><div className="text-[hsl(var(--muted))]">Low</div></div>
                <div className="rounded-xl bg-slate-50 p-2"><div className="font-semibold">{metrics.outOfStockProducts}</div><div className="text-[hsl(var(--muted))]">Out</div></div>
                <div className="rounded-xl bg-slate-50 p-2"><div className="font-semibold">{metrics.preorderEnabledProducts}</div><div className="text-[hsl(var(--muted))]">Preorder</div></div>
              </div>
            </Link>

            {canManageSales ? (
              <Link href="/admin/store/sales?money=outstanding" className="rounded-2xl border bg-white p-4 transition hover:bg-gray-50">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Sales & debt</div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">Today, this month, and outstanding sale debt.</div>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${salesOverview.outstandingDebtCents > 0 ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{salesOverview.outstandingCount} debt</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-xl bg-slate-50 p-2"><div className="font-semibold">{salesOverview.todaySales}</div><div className="text-[hsl(var(--muted))]">Today</div></div>
                  <div className="rounded-xl bg-slate-50 p-2"><div className="font-semibold">{salesOverview.monthSales}</div><div className="text-[hsl(var(--muted))]">Month</div></div>
                  <div className="rounded-xl bg-slate-50 p-2"><div className="font-semibold">{formatCurrency(salesOverview.outstandingDebtCents, 'en-EG', 'EGP')}</div><div className="text-[hsl(var(--muted))]">Debt</div></div>
                </div>
              </Link>
            ) : null}

            {canManagePreorders ? (
              <Link href="/admin/store/preorders?money=balance_due" className="rounded-2xl border bg-white p-4 transition hover:bg-gray-50">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Preorders</div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">Open preorders, balances, and ready-to-complete items.</div>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${preorderOverview.balanceDueCents > 0 ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{preorderOverview.balanceDueCount} balance</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-xl bg-slate-50 p-2"><div className="font-semibold">{preorderOverview.openPreorders}</div><div className="text-[hsl(var(--muted))]">Open</div></div>
                  <div className="rounded-xl bg-slate-50 p-2"><div className="font-semibold">{formatCurrency(preorderOverview.balanceDueCents, 'en-EG', 'EGP')}</div><div className="text-[hsl(var(--muted))]">Balance</div></div>
                  <div className="rounded-xl bg-slate-50 p-2"><div className="font-semibold">{preorderOverview.readyToComplete}</div><div className="text-[hsl(var(--muted))]">Ready</div></div>
                </div>
              </Link>
            ) : null}

            {canManageSupplierOrders ? (
              <Link href="/admin/store?tab=supplier-orders&s_receiving=pending" className="rounded-2xl border bg-white p-4 transition hover:bg-gray-50">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Supplier receiving</div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">Pending and partially received supplier orders.</div>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${supplierOverview.remainingUnits > 0 ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{supplierOverview.remainingUnits} units</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-xl bg-slate-50 p-2"><div className="font-semibold">{supplierOverview.pendingReceiving}</div><div className="text-[hsl(var(--muted))]">Pending</div></div>
                  <div className="rounded-xl bg-slate-50 p-2"><div className="font-semibold">{supplierOverview.partiallyReceived}</div><div className="text-[hsl(var(--muted))]">Partial</div></div>
                  <div className="rounded-xl bg-slate-50 p-2"><div className="font-semibold">{supplierOverview.receivedUnits}/{supplierOverview.orderedUnits}</div><div className="text-[hsl(var(--muted))]">Received</div></div>
                </div>
              </Link>
            ) : null}

            {canSeeExpenses ? (
              <Link href="/admin/store/expenses?proof=missing_proof" className="rounded-2xl border bg-white p-4 transition hover:bg-gray-50">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Expenses proof</div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">This month expenses and missing proof count.</div>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${expenseOverview.missingProofCount > 0 ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{expenseOverview.missingProofCount} missing</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-xl bg-slate-50 p-2"><div className="font-semibold">{formatCurrency(expenseOverview.monthExpensesCents, 'en-EG', 'EGP')}</div><div className="text-[hsl(var(--muted))]">Month</div></div>
                  <div className="rounded-xl bg-slate-50 p-2"><div className="font-semibold">{expenseOverview.supplierLinkedCount}</div><div className="text-[hsl(var(--muted))]">Supplier</div></div>
                  <div className="rounded-xl bg-slate-50 p-2"><div className="font-semibold">{expenseOverview.withProofCount}</div><div className="text-[hsl(var(--muted))]">Proof</div></div>
                </div>
              </Link>
            ) : null}

            {canSeeFunding ? (
              <Link href="/admin/store/funding?proof=missing" className="rounded-2xl border bg-white p-4 transition hover:bg-gray-50">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Funding repayment</div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted))]">Loan received, repaid, remaining, and proof status.</div>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${fundingOverview.remainingToRepayCents > 0 ? 'border-violet-200 bg-violet-50 text-violet-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>Funding</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-xl bg-slate-50 p-2"><div className="font-semibold">{formatCurrency(fundingOverview.loanReceivedCents, 'en-EG', 'EGP')}</div><div className="text-[hsl(var(--muted))]">Received</div></div>
                  <div className="rounded-xl bg-slate-50 p-2"><div className="font-semibold">{formatCurrency(fundingOverview.loanRepaidCents, 'en-EG', 'EGP')}</div><div className="text-[hsl(var(--muted))]">Repaid</div></div>
                  <div className="rounded-xl bg-slate-50 p-2"><div className="font-semibold">{formatCurrency(fundingOverview.remainingToRepayCents, 'en-EG', 'EGP')}</div><div className="text-[hsl(var(--muted))]">Remaining</div></div>
                </div>
              </Link>
            ) : null}
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Link href="/admin/store?tab=catalog" className={`rounded-xl border px-4 py-2 text-sm font-medium ${tab === 'catalog' ? 'bg-black text-white border-black' : 'hover:bg-gray-50'}`}>
            Catalog & Stock
          </Link>
          {canManageSupplierOrders ? (
            <Link href="/admin/store?tab=supplier-orders" className={`rounded-xl border px-4 py-2 text-sm font-medium ${tab === 'supplier-orders' ? 'bg-black text-white border-black' : 'hover:bg-gray-50'}`}>
              Supplier Orders
            </Link>
          ) : null}
          {canManageCatalog ? (
            <Link href="/admin/store/models" className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50">
              Models
            </Link>
          ) : null}
          {canManagePreorders ? (
            <Link href="/admin/store/preorders" className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50">
              Preorders
            </Link>
          ) : null}
          {canManageSales ? (
            <Link href="/admin/store/sales" className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50">
              Sales & Debt
            </Link>
          ) : null}
        </div>

        {tab === 'catalog' && (
          <div className={`grid gap-3 ${canManageCatalog ? 'xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]' : 'xl:grid-cols-1'}`}>
            {canManageCatalog ? (
              <div id="quick-add-product">
                <Card className={`p-4 ${initialVariant ? 'border-sky-200 ring-1 ring-sky-100' : ''}`}>
                  <CardHeader className="mb-2">
                    <CardTitle className="text-lg">{initialVariant ? 'Quick add variant' : 'Quick add product'}</CardTitle>
                    <div className="text-xs text-[hsl(var(--muted))]">{initialVariant ? 'Add a new variant from an existing product model with the main fields prefilled.' : 'Create a sellable Store variant with only the essential fields first.'}</div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <AdminStoreProductCreateForm initialVariant={initialVariant} />
                    <div className="rounded-2xl border border-dashed p-3">
                      <StoreCategoryManager />
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <Card>
                <CardHeader><CardTitle>Catalog access</CardTitle></CardHeader>
                <CardContent className="text-sm text-[hsl(var(--muted))]">
                  Read-only catalog access for your role. Product create, edit, delete, supplier orders, preorders, and sales stay restricted to super admin.
                </CardContent>
              </Card>
            )}

            <div className="grid gap-3">
              <Card className="p-4">
                <CardHeader className="mb-2">
                  <CardTitle className="text-lg">Find products faster</CardTitle>
                  <div className="text-xs text-[hsl(var(--muted))]">Search and filter the catalog without changing Store data.</div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <Link href={buildUrl('/admin/store', { tab: 'catalog', stock: 'low', page_size: String(pageSize) })} className="rounded-2xl border bg-white p-3 text-sm transition hover:bg-gray-50">
                      <div className="font-semibold">Low stock</div>
                      <div className="mt-1 text-xs text-[hsl(var(--muted))]">{metrics.lowStockProducts} product(s)</div>
                    </Link>
                    <Link href={buildUrl('/admin/store', { tab: 'catalog', stock: 'out', page_size: String(pageSize) })} className="rounded-2xl border bg-white p-3 text-sm transition hover:bg-gray-50">
                      <div className="font-semibold">Out of stock</div>
                      <div className="mt-1 text-xs text-[hsl(var(--muted))]">{metrics.outOfStockProducts} product(s)</div>
                    </Link>
                    <Link href={buildUrl('/admin/store', { tab: 'catalog', active: 'inactive', page_size: String(pageSize) })} className="rounded-2xl border bg-white p-3 text-sm transition hover:bg-gray-50">
                      <div className="font-semibold">Inactive</div>
                      <div className="mt-1 text-xs text-[hsl(var(--muted))]">{metrics.totalProducts - metrics.activeProducts} product(s)</div>
                    </Link>
                    <Link href={buildUrl('/admin/store', { tab: 'catalog', preorder: '1', page_size: String(pageSize) })} className="rounded-2xl border bg-white p-3 text-sm transition hover:bg-gray-50">
                      <div className="font-semibold">Preorders</div>
                      <div className="mt-1 text-xs text-[hsl(var(--muted))]">{metrics.preorderEnabledProducts} product(s)</div>
                    </Link>
                  </div>

                  <form className="grid gap-3 lg:grid-cols-12">
                    <input type="hidden" name="tab" value="catalog" />
                    <label className="block lg:col-span-4">
                      <span className="mb-1 block text-sm font-medium">Search</span>
                      <input name="q" defaultValue={q} placeholder="Name, model, color, size, ID…" className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm" />
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-sm font-medium">Category</span>
                      <select name="category" defaultValue={category} className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                        {categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-sm font-medium">Active</span>
                      <select name="active" defaultValue={active} className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                        {ACTIVE_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-sm font-medium">Stock</span>
                      <select name="stock" defaultValue={stock} className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                        {STOCK_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-sm font-medium">Preorder</span>
                      <select name="preorder" defaultValue={preorder} className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                        {PREORDER_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-sm font-medium">Per page</span>
                      <select name="page_size" defaultValue={String(pageSize)} className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                        {CATALOG_PAGE_SIZE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                    <div className="flex items-end gap-2 lg:col-span-10">
                      <button className="min-h-[42px] rounded-xl bg-black px-4 py-2 text-sm font-medium text-white">Apply</button>
                      <Link href="/admin/store?tab=catalog" className="inline-flex min-h-[42px] items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50">Reset</Link>
                    </div>
                  </form>
                </CardContent>
              </Card>

              <Card className="p-4">
                <CardHeader className="mb-2">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg">Restock helper</CardTitle>
                      <div className="mt-1 text-xs text-[hsl(var(--muted))]">Low stock, out of stock, and preorder-enabled variants that may need attention. No automatic stock change.</div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 font-medium text-amber-800">Urgent: {urgentRestockCount}</span>
                      <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-1 font-medium text-violet-800">Preorder: {preorderRestockCount}</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {visibleRestockSuggestions.length === 0 ? (
                    <div className="rounded-2xl border border-dashed p-4 text-sm text-[hsl(var(--muted))]">No active product currently needs restock attention.</div>
                  ) : (
                    <div className="grid gap-2">
                      {visibleRestockSuggestions.map((suggestion) => {
                        const product = suggestion.product
                        const modelName = productModelGroupLabel(product)
                        const variantLabel = formatVariantLabel(product)
                        const focusParams: Record<string, string> = {
                          tab: 'catalog',
                          q: product.model?.name ?? product.name,
                          category: product.category,
                          stock: suggestion.status === 'out' ? 'out' : suggestion.status === 'low' ? 'low' : '',
                          preorder: suggestion.status === 'preorder' ? '1' : '',
                          page_size: String(pageSize),
                        }
                        const focusHref = `${buildUrl('/admin/store', focusParams)}#product-${product.id}`

                        return (
                          <div key={product.id} className="rounded-2xl border bg-white p-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="truncate text-sm font-semibold">{modelName}</div>
                                  {restockStatusPill(suggestion.status)}
                                </div>
                                <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-[hsl(var(--muted))]">
                                  <span className="rounded-full border px-2 py-0.5">{variantLabel}</span>
                                  <span className="rounded-full border px-2 py-0.5">Stock: {product.inventory_qty}</span>
                                  <span className="rounded-full border px-2 py-0.5">Threshold: {product.low_stock_threshold}</span>
                                  <span className="rounded-full border px-2 py-0.5">Suggested: +{suggestion.suggestedQty} → {suggestion.targetStock}</span>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Link
                                  prefetch={false}
                                  href={focusHref}
                                  className="inline-flex min-h-[34px] items-center rounded-xl border px-3 py-1.5 text-xs font-semibold hover:bg-gray-50"
                                >
                                  Open variant
                                </Link>
                                {canManageSupplierOrders ? (
                                  <Link
                                    prefetch={false}
                                    href="/admin/store?tab=supplier-orders"
                                    className="inline-flex min-h-[34px] items-center rounded-xl border px-3 py-1.5 text-xs font-semibold hover:bg-gray-50"
                                  >
                                    Supplier orders
                                  </Link>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        )
                      })}

                      {restockSuggestions.length > RESTOCK_HELPER_LIMIT ? (
                        <div className="rounded-2xl border border-dashed p-3 text-xs text-[hsl(var(--muted))]">
                          Showing {RESTOCK_HELPER_LIMIT} of {restockSuggestions.length} restock item(s). Use Low stock, Out of stock, or Preorder filters to review the full list.
                        </div>
                      ) : null}
                    </div>
                  )}
                </CardContent>
              </Card>

              {productsError ? (
                <Card>
                  <CardContent className="text-sm text-red-700">Catalog query failed: {productsError}</CardContent>
                </Card>
              ) : (
                <Card className="p-4">
                  <CardHeader className="mb-2">
                    <CardTitle className="text-lg">Catalog & stock</CardTitle>
                    <div className="text-xs text-[hsl(var(--muted))]">{totalFilteredProducts} product(s) in {totalFilteredGroups} model group(s) · {pageSize} group(s)/page · showing {shownProductCount} product(s)</div>
                  </CardHeader>
                  <CardContent className="grid gap-2">
                    {(q || category !== 'all' || active !== 'all' || stock !== 'all' || preorder !== 'all') ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-slate-50 p-3 text-xs">
                        <span className="font-semibold">Active filters</span>
                        {q ? <span className="rounded-full border bg-white px-2 py-1">Search: {q}</span> : null}
                        {category !== 'all' ? <span className="rounded-full border bg-white px-2 py-1">Category: {categoryLabels.get(category) ?? category}</span> : null}
                        {active !== 'all' ? <span className="rounded-full border bg-white px-2 py-1">Active: {active}</span> : null}
                        {stock !== 'all' ? <span className="rounded-full border bg-white px-2 py-1">Stock: {STOCK_FILTERS.find((option) => option.value === stock)?.label ?? stock}</span> : null}
                        {preorder !== 'all' ? <span className="rounded-full border bg-white px-2 py-1">Preorder: {PREORDER_FILTERS.find((option) => option.value === preorder)?.label ?? preorder}</span> : null}
                        <Link href="/admin/store?tab=catalog" className="ml-auto rounded-full border bg-white px-2 py-1 font-medium hover:bg-gray-50">Clear all</Link>
                      </div>
                    ) : null}
                    {pagedProductGroups.length === 0 ? (
                      <div className="rounded-2xl border border-dashed p-4 text-sm text-[hsl(var(--muted))]">No products match the current filters.</div>
                    ) : (
                      pagedProductGroups.map((group) => {
                        const representative = group.representative
                        return (
                          <div key={group.key} className="rounded-2xl border bg-white p-3 shadow-sm">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="truncate text-base font-semibold">{group.modelName}</div>
                                  <span className="rounded-full border bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">{group.products.length} variant{group.products.length === 1 ? '' : 's'}</span>
                                </div>
                                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-[hsl(var(--muted))]">
                                  <span className="rounded-full border px-2 py-0.5">{categoryLabels.get(group.category) ?? group.category}</span>
                                  {group.modelId ? (
                                    <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-700">Model ID: {shortId(group.modelId)}</span>
                                  ) : (
                                    <span className="rounded-full border border-rose-300 bg-rose-100 px-2 py-0.5 font-medium text-rose-900">Ungrouped product · linked model missing</span>
                                  )}
                                  {group.inactiveCount > 0 ? <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-slate-700">{group.inactiveCount} inactive</span> : null}
                                  {group.preorderCount > 0 ? <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-violet-700">{group.preorderCount} preorder</span> : null}
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {groupStockPill(group)}
                                <span className="rounded-full border bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">Total stock: {group.totalStock}</span>
                              </div>
                            </div>

                            <div className="mt-3 grid gap-1.5 rounded-xl bg-slate-50 p-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
                              <div><span className="text-[hsl(var(--muted))]">Price:</span> <span className="font-medium">{priceRangeLabel(group, representative.currency)}</span></div>
                              <div><span className="text-[hsl(var(--muted))]">Variants:</span> <span className="font-medium">{group.products.length}</span></div>
                              <div><span className="text-[hsl(var(--muted))]">Low/out:</span> <span className="font-medium">{group.lowStockCount} / {group.outOfStockCount}</span></div>
                              <div><span className="text-[hsl(var(--muted))]">Latest:</span> <span className="font-medium">{formatDateTime(group.latestCreatedAt)}</span></div>
                            </div>

                            {canManageCatalog ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {group.modelId ? (
                                  <Link
                                    prefetch={false}
                                    href={`${buildUrl('/admin/store', {
                                      ...catalogBaseParams,
                                      page: String(safeProductPage),
                                      variant_from: representative.id,
                                      variant_category: representative.category,
                                      variant_model_id: group.modelId,
                                      variant_model_name: group.modelName,
                                      variant_price_cents: String(representative.price_cents),
                                    })}#quick-add-product`}
                                    className="inline-flex min-h-[34px] items-center rounded-xl border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100"
                                  >
                                    Add variant
                                  </Link>
                                ) : (
                                  <span className="inline-flex min-h-[34px] items-center rounded-xl border bg-slate-50 px-3 py-1.5 text-xs text-[hsl(var(--muted))]">Add variant unavailable · missing model</span>
                                )}
                              </div>
                            ) : null}

                            <div className="mt-3 grid gap-2">
                              {group.products.map((product) => (
                                <details id={`product-${product.id}`} key={product.id} className="scroll-mt-24 rounded-2xl border bg-white p-3" open={group.products.length === 1 || isLowStock(product)}>
                                  <summary className="cursor-pointer list-none">
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                      <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-semibold">{formatVariantLabel(product)}</div>
                                        <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-[hsl(var(--muted))]">
                                          <span className="rounded-full border px-2 py-0.5">ID: {shortId(product.id)}</span>
                                          {product.name && product.name !== group.modelName ? <span className="rounded-full border px-2 py-0.5">Name: {product.name}</span> : null}
                                          {product.size ? <span className="rounded-full border px-2 py-0.5">Size: {product.size}</span> : null}
                                          {product.color ? <span className="rounded-full border px-2 py-0.5">Color: {product.color}</span> : null}
                                        </div>
                                      </div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        {stockPill(product)}
                                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${product.allow_preorder ? 'border-violet-200 bg-violet-50 text-violet-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                                          {product.allow_preorder ? 'Preorder' : 'No preorder'}
                                        </span>
                                      </div>
                                    </div>
                                  </summary>

                                  <div className="mt-3 grid gap-3 border-t pt-3">
                                    <ProductImageStrip
                                      name={product.name}
                                      imageUrls={[
                                        resolveStoreProductImageUrl(product.image_path),
                                        resolveStoreProductImageUrl(product.image_path_2),
                                        resolveStoreProductImageUrl(product.image_path_3),
                                      ]}
                                    />

                                    <div className="grid gap-1.5 rounded-xl bg-slate-50 p-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
                                      <div><span className="text-[hsl(var(--muted))]">Price:</span> <span className="font-medium">{formatCurrency(product.price_cents, 'en-EG', product.currency ?? 'EGP')}</span></div>
                                      <div><span className="text-[hsl(var(--muted))]">Stock:</span> <span className="font-medium">{product.inventory_qty}</span></div>
                                      <div><span className="text-[hsl(var(--muted))]">Threshold:</span> <span className="font-medium">{product.low_stock_threshold}</span></div>
                                      <div><span className="text-[hsl(var(--muted))]">Created:</span> <span className="font-medium">{formatDateTime(product.created_at)}</span></div>
                                    </div>

                                    {canManageCatalog ? (
                                      <AdminProductQuickEdit
                                        id={product.id}
                                        category={product.category}
                                        modelId={product.model_id}
                                        modelName={product.model?.name ?? null}
                                        name={product.name}
                                        color={product.color}
                                        size={product.size}
                                        priceCents={product.price_cents}
                                        currency={product.currency}
                                        inventoryQty={product.inventory_qty}
                                        isActive={product.is_active}
                                        allowPreorder={product.allow_preorder}
                                        lowStockThreshold={product.low_stock_threshold}
                                        imagePath={product.image_path}
                                        imagePath2={product.image_path_2}
                                        imagePath3={product.image_path_3}
                                      />
                                    ) : (
                                      <div className="text-xs text-[hsl(var(--muted))]">Read-only catalog access for your role.</div>
                                    )}
                                  </div>
                                </details>
                              ))}
                            </div>
                          </div>
                        )
                      })
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-sm">
                      <div>Page {safeProductPage} / {totalProductPages}</div>
                      <div className="flex gap-2">
                        <Link href={buildUrl('/admin/store', { ...catalogBaseParams, page: String(Math.max(1, safeProductPage - 1)) })} className={`rounded-xl border px-3 py-1.5 ${safeProductPage <= 1 ? 'pointer-events-none opacity-50' : 'hover:bg-gray-50'}`}>Previous</Link>
                        <Link href={buildUrl('/admin/store', { ...catalogBaseParams, page: String(safeProductPage + 1) })} className={`rounded-xl border px-3 py-1.5 ${!hasMoreProducts ? 'pointer-events-none opacity-50' : 'hover:bg-gray-50'}`}>Next</Link>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}

        {tab === 'supplier-orders' && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,430px)_minmax(0,1fr)]">
            <Card>
              <CardHeader><CardTitle>Create supplier order</CardTitle></CardHeader>
              <CardContent>
                <SupplierOrderForm
                  products={allProducts.map((product) => ({
                    id: product.id,
                    name: product.name,
                    category: product.category,
                    color: product.color,
                    size: product.size,
                    price_cents: product.price_cents,
                    currency: product.currency,
                    inventory_qty: product.inventory_qty,
                    is_active: product.is_active,
                  }))}
                />
              </CardContent>
            </Card>

            <div className="grid gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Supplier receiving overview</CardTitle>
                  <div className="text-xs text-[hsl(var(--muted))]">Track expected supplier cost and receiving progress for the current view.</div>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border bg-white p-3">
                    <div className="text-xs text-[hsl(var(--muted))]">Orders tracked</div>
                    <div className="mt-1 text-xl font-semibold">{supplierHistoryMetrics.trackedOrders}</div>
                    <div className="mt-1 text-[11px] text-[hsl(var(--muted))]">Draft: {supplierHistoryMetrics.draftOrders}</div>
                  </div>
                  <div className="rounded-2xl border bg-white p-3">
                    <div className="text-xs text-[hsl(var(--muted))]">Estimated supplier total</div>
                    <div className="mt-1 text-xl font-semibold">{formatCurrency(supplierHistoryMetrics.estimatedSupplierTotalCents)}</div>
                    <div className="mt-1 text-[11px] text-[hsl(var(--muted))]">Current filtered orders</div>
                  </div>
                  <div className="rounded-2xl border bg-white p-3">
                    <div className="text-xs text-[hsl(var(--muted))]">Units</div>
                    <div className="mt-1 text-xl font-semibold">{supplierHistoryMetrics.receivedUnits} / {supplierHistoryMetrics.orderedUnits}</div>
                    <div className="mt-1 text-[11px] text-[hsl(var(--muted))]">Received / ordered</div>
                  </div>
                  <div className="rounded-2xl border bg-white p-3">
                    <div className="text-xs text-[hsl(var(--muted))]">Remaining units</div>
                    <div className="mt-1 text-xl font-semibold">{supplierHistoryMetrics.remainingUnits}</div>
                    <div className="mt-1 text-[11px] text-[hsl(var(--muted))]">Pending: {supplierHistoryMetrics.pendingReceiving} · Partial: {supplierHistoryMetrics.partiallyReceived} · Received: {supplierHistoryMetrics.fullyReceived}</div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Supplier-order filters</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Link href={buildUrl('/admin/store', { tab: 'supplier-orders', s_page_size: String(supplierPageSize) })} className={`rounded-xl border px-3 py-2 text-xs font-medium ${supplierStatus === 'all' && supplierReceiving === 'all' && supplierPeriod === 'all' && !supplierQ ? 'border-black bg-black text-white' : 'hover:bg-gray-50'}`}>All</Link>
                    <Link href={buildUrl('/admin/store', { tab: 'supplier-orders', s_receiving: 'pending', s_page_size: String(supplierPageSize) })} className={`rounded-xl border px-3 py-2 text-xs font-medium ${supplierReceiving === 'pending' ? 'border-black bg-black text-white' : 'hover:bg-gray-50'}`}>Pending receiving</Link>
                    <Link href={buildUrl('/admin/store', { tab: 'supplier-orders', s_receiving: 'partial', s_page_size: String(supplierPageSize) })} className={`rounded-xl border px-3 py-2 text-xs font-medium ${supplierReceiving === 'partial' ? 'border-black bg-black text-white' : 'hover:bg-gray-50'}`}>Partially received</Link>
                    <Link href={buildUrl('/admin/store', { tab: 'supplier-orders', s_receiving: 'received', s_page_size: String(supplierPageSize) })} className={`rounded-xl border px-3 py-2 text-xs font-medium ${supplierReceiving === 'received' ? 'border-black bg-black text-white' : 'hover:bg-gray-50'}`}>Fully received</Link>
                    <Link href={buildUrl('/admin/store', { tab: 'supplier-orders', s_receiving: 'draft', s_page_size: String(supplierPageSize) })} className={`rounded-xl border px-3 py-2 text-xs font-medium ${supplierReceiving === 'draft' ? 'border-black bg-black text-white' : 'hover:bg-gray-50'}`}>Draft</Link>
                    <Link href={buildUrl('/admin/store', { tab: 'supplier-orders', s_period: 'month', s_page_size: String(supplierPageSize) })} className={`rounded-xl border px-3 py-2 text-xs font-medium ${supplierPeriod === 'month' ? 'border-black bg-black text-white' : 'hover:bg-gray-50'}`}>This month</Link>
                  </div>

                  <form className="grid gap-3 lg:grid-cols-12">
                    <input type="hidden" name="tab" value="supplier-orders" />
                    <label className="block lg:col-span-4">
                      <span className="mb-1 block text-sm font-medium">Search</span>
                      <input name="s_q" defaultValue={supplierQ} placeholder="Reference or supplier…" className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm" />
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-sm font-medium">Status</span>
                      <select name="s_status" defaultValue={supplierStatus} className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                        {SUPPLIER_STATUS_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-sm font-medium">Receiving</span>
                      <select name="s_receiving" defaultValue={supplierReceiving} className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                        {SUPPLIER_RECEIVING_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-sm font-medium">Period</span>
                      <select name="s_period" defaultValue={supplierPeriod} className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                        {SUPPLIER_PERIOD_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-sm font-medium">Per page</span>
                      <select name="s_page_size" defaultValue={String(supplierPageSize)} className="min-h-[42px] w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm">
                        {[5, 10, 20, 30].map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                    <div className="flex items-end gap-2 lg:col-span-12">
                      <button className="min-h-[42px] rounded-xl bg-black px-4 py-2 text-sm font-medium text-white">Apply</button>
                      <Link href="/admin/store?tab=supplier-orders" className="inline-flex min-h-[42px] items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50">Reset</Link>
                    </div>
                  </form>
                </CardContent>
              </Card>

              {supplierError ? (
                <Card>
                  <CardContent className="text-sm text-red-700">Supplier orders query failed: {supplierError}</CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>Supplier orders</CardTitle>
                    <div className="text-xs text-[hsl(var(--muted))]">{totalSupplierOrders} matching order(s) · {supplierHistoryMetrics.remainingUnits} unit(s) still pending</div>
                  </CardHeader>
                  <CardContent className="grid gap-4">
                    {pagedSupplierOrders.length === 0 ? (
                      <div className="rounded-2xl border border-dashed p-4 text-sm text-[hsl(var(--muted))]">No supplier orders match the current filters.</div>
                    ) : (
                      pagedSupplierOrders.map((order) => {
                        const orderTotals = computeSupplierOrderTotals(order)

                        return (
                          <div key={order.id} className={`rounded-2xl border p-4 ${supplierOrderToneClass(order, orderTotals)}`}>
                            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold">{order.supplier_name || 'Supplier'}</div>
                                <div className="mt-1 flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
                                  <span className="rounded-full border px-2 py-1">Order ID: {shortId(order.id)}</span>
                                  {order.reference ? <span className="rounded-full border px-2 py-1">Ref: {order.reference}</span> : null}
                                  <span className="rounded-full border px-2 py-1">Ordered qty: {orderTotals.orderedQty}</span>
                                  <span className="rounded-full border px-2 py-1">Received qty: {orderTotals.receivedQty}</span>
                                  <span className="rounded-full border px-2 py-1">Remaining qty: {orderTotals.remainingQty}</span>
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {supplierStatusPill(order.status)}
                                {supplierReceivingPill(order, orderTotals)}
                              </div>
                            </div>

                            <div className="mb-4 rounded-2xl border bg-white p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <div className="text-sm font-semibold">Receiving progress</div>
                                  <div className="text-xs text-[hsl(var(--muted))]">{orderTotals.receivedQty} received · {orderTotals.remainingQty} remaining · {orderTotals.pendingLineCount} pending line(s)</div>
                                </div>
                                <div className="text-sm font-semibold">{orderTotals.progressPercent}%</div>
                              </div>
                              <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
                                <div className="h-full rounded-full bg-black" style={{ width: `${orderTotals.progressPercent}%` }} />
                              </div>
                            </div>

                            {canSeeExpenses ? (
                              <div className="mb-3 flex flex-wrap gap-2">
                                <Link
                                  href={`${buildUrl('/admin/store/expenses', { supplier_order_id: order.id, preset: 'custom', from: '2020-01-01', to: storeExpenseLinkTo })}#add-store-expense`}
                                  className="inline-flex items-center rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-xs font-medium hover:bg-gray-50"
                                >
                                  Create linked expense
                                </Link>
                                <Link
                                  href={buildUrl('/admin/store/expenses', { supplier_order_id: order.id, preset: 'custom', from: '2020-01-01', to: storeExpenseLinkTo })}
                                  className="inline-flex items-center rounded-xl border border-[hsl(var(--border))] px-3 py-2 text-xs font-medium hover:bg-gray-50"
                                >
                                  View linked expenses
                                </Link>
                              </div>
                            ) : null}

                            <div className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
                              <div><span className="text-[hsl(var(--muted))]">Expected:</span> <span className="font-medium">{order.expected_at || '—'}</span></div>
                              <div><span className="text-[hsl(var(--muted))]">Ordered at:</span> <span className="font-medium">{formatDateTime(order.ordered_at)}</span></div>
                              <div><span className="text-[hsl(var(--muted))]">Received at:</span> <span className="font-medium">{formatDateTime(order.received_at)}</span></div>
                              <div><span className="text-[hsl(var(--muted))]">Estimated cost:</span> <span className="font-medium">{formatCurrency(orderTotals.totalCostCents)}</span></div>
                              <div><span className="text-[hsl(var(--muted))]">Lines:</span> <span className="font-medium">{orderTotals.lineCount}</span></div>
                              <div><span className="text-[hsl(var(--muted))]">Received lines:</span> <span className="font-medium">{orderTotals.receivedLineCount}</span></div>
                              <div><span className="text-[hsl(var(--muted))]">Pending lines:</span> <span className="font-medium">{orderTotals.pendingLineCount}</span></div>
                              <div><span className="text-[hsl(var(--muted))]">Receiving:</span> <span className="font-medium">{supplierOrderReceivingLabel(order, orderTotals)}</span></div>
                            </div>

                            <div className="mt-4">
                              <SupplierOrderHeaderEditor
                                id={order.id}
                                reference={order.reference}
                                supplierName={order.supplier_name}
                                expectedAt={order.expected_at}
                                notes={order.notes}
                                status={order.status}
                              />
                            </div>

                            <div className="mt-4 grid gap-3">
                              {(order.items ?? []).length === 0 ? (
                                <div className="rounded-2xl border border-dashed p-3 text-sm text-[hsl(var(--muted))]">No lines on this supplier order.</div>
                              ) : (
                                (order.items ?? []).map((item) => {
                                  const linkedProduct = item.product_id ? productById.get(item.product_id) ?? null : null
                                  const remainingQty = Math.max(0, Number(item.ordered_qty ?? 0) - Number(item.received_qty ?? 0))
                                  const lineProgressPercent = Math.max(0, Number(item.ordered_qty ?? 0)) > 0 ? Math.min(100, Math.round((Math.max(0, Number(item.received_qty ?? 0)) / Math.max(0, Number(item.ordered_qty ?? 0))) * 100)) : 0
                                  return (
                                    <div key={item.id} className="rounded-2xl border bg-white p-3">
                                      <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div>
                                          <div className="text-sm font-medium">{item.product_name}</div>
                                          <div className="mt-1 flex flex-wrap gap-2 text-xs text-[hsl(var(--muted))]">
                                            {item.product_id ? <span className="rounded-full border px-2 py-1">Product ID: {shortId(item.product_id)}</span> : null}
                                            {item.product_size ? <span className="rounded-full border px-2 py-1">Size: {item.product_size}</span> : null}
                                            {item.product_color ? <span className="rounded-full border px-2 py-1">Color: {item.product_color}</span> : null}
                                            {item.product_category ? <span className="rounded-full border px-2 py-1">{item.product_category}</span> : null}
                                          </div>
                                        </div>
                                        <div>{supplierLinePill(item.line_status)}</div>
                                      </div>

                                      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-5">
                                        <div><span className="text-[hsl(var(--muted))]">Unit cost:</span> <span className="font-medium">{formatCurrency(item.unit_cost_cents)}</span></div>
                                        <div><span className="text-[hsl(var(--muted))]">Ordered:</span> <span className="font-medium">{item.ordered_qty}</span></div>
                                        <div><span className="text-[hsl(var(--muted))]">Received:</span> <span className="font-medium">{item.received_qty}</span></div>
                                        <div><span className="text-[hsl(var(--muted))]">Remaining:</span> <span className="font-medium">{remainingQty}</span></div>
                                        <div><span className="text-[hsl(var(--muted))]">Line total:</span> <span className="font-medium">{formatCurrency(item.line_total_cents)}</span></div>
                                      </div>

                                      <div className="mt-3 rounded-xl border bg-gray-50 p-2">
                                        <div className="flex items-center justify-between gap-2 text-xs">
                                          <span className="text-[hsl(var(--muted))]">Line receiving progress</span>
                                          <span className="font-medium">{lineProgressPercent}%</span>
                                        </div>
                                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                                          <div className="h-full rounded-full bg-black" style={{ width: `${lineProgressPercent}%` }} />
                                        </div>
                                      </div>

                                      <div className="mt-4">
                                        <SupplierOrderReceiveLine
                                          itemId={item.id}
                                          orderedQty={item.ordered_qty}
                                          receivedQty={item.received_qty}
                                          lineStatus={item.line_status}
                                          productName={item.product_name}
                                          productId={item.product_id}
                                          productColor={item.product_color}
                                          productSize={item.product_size}
                                          currentStock={linkedProduct?.inventory_qty ?? null}
                                          productActive={linkedProduct?.is_active ?? null}
                                        />
                                      </div>
                                    </div>
                                  )
                                })
                              )}
                            </div>
                          </div>
                        )
                      })
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-sm">
                      <div>Page {safeSupplierPage} / {totalSupplierPages}</div>
                      <div className="flex gap-2">
                        <Link href={buildUrl('/admin/store', { ...supplierBaseParams, s_page: String(Math.max(1, safeSupplierPage - 1)) })} className={`rounded-xl border px-4 py-2 ${safeSupplierPage <= 1 ? 'pointer-events-none opacity-50' : 'hover:bg-gray-50'}`}>Previous</Link>
                        <Link href={buildUrl('/admin/store', { ...supplierBaseParams, s_page: String(safeSupplierPage + 1) })} className={`rounded-xl border px-4 py-2 ${!hasMoreSupplierOrders ? 'pointer-events-none opacity-50' : 'hover:bg-gray-50'}`}>Next</Link>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}
      </Section>
    </main>
  )
}
