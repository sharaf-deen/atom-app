export const STORE_CATEGORIES = ['kimono', 'rashguard', 'short', 'belt'] as const
export type StoreCategory = (typeof STORE_CATEGORIES)[number]

export const STORE_PAYMENT_METHODS = ['cash', 'instapay', 'bank_transfer', 'card'] as const
export type StorePaymentMethod = (typeof STORE_PAYMENT_METHODS)[number]

export const STORE_SUPPLIER_ORDER_STATUSES = [
  'draft',
  'ordered',
  'partially_received',
  'received',
  'canceled',
] as const
export type StoreSupplierOrderStatus = (typeof STORE_SUPPLIER_ORDER_STATUSES)[number]

export const STORE_SUPPLIER_ORDER_ITEM_STATUSES = [
  'ordered',
  'partially_received',
  'received',
  'canceled',
] as const
export type StoreSupplierOrderItemStatus = (typeof STORE_SUPPLIER_ORDER_ITEM_STATUSES)[number]

export const STORE_PREORDER_STATUSES = [
  'pending',
  'confirmed',
  'ordered_from_supplier',
  'ready',
  'completed',
  'canceled',
] as const
export type StorePreorderStatus = (typeof STORE_PREORDER_STATUSES)[number]

export const STORE_SALE_STATUSES = ['draft', 'partial_paid', 'paid', 'delivered', 'canceled'] as const
export type StoreSaleStatus = (typeof STORE_SALE_STATUSES)[number]

export type StoreProductSnapshot = {
  product_id: string | null
  product_name: string
  product_category: StoreCategory | null
  product_color: string | null
  product_size: string | null
}

export type StoreSupplierOrderRow = {
  id: string
  reference: string | null
  supplier_name: string | null
  status: StoreSupplierOrderStatus
  notes: string | null
  ordered_at: string | null
  expected_at: string | null
  received_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type StoreSupplierOrderItemRow = StoreProductSnapshot & {
  id: string
  supplier_order_id: string
  unit_cost_cents: number
  ordered_qty: number
  received_qty: number
  line_total_cents: number
  line_status: StoreSupplierOrderItemStatus
  created_at: string
  updated_at: string
}

export type StorePreorderRow = StoreProductSnapshot & {
  id: string
  buyer_user_id: string
  buyer_full_name: string | null
  buyer_email: string | null
  buyer_phone: string | null
  qty: number
  unit_price_cents: number
  total_cents: number
  deposit_cents: number
  balance_due_cents: number
  deposit_payment_method: StorePaymentMethod | null
  status: StorePreorderStatus
  note: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type StoreSaleRow = {
  id: string
  buyer_user_id: string | null
  buyer_full_name: string | null
  buyer_email: string | null
  buyer_phone: string | null
  status: StoreSaleStatus
  payment_method: StorePaymentMethod | null
  notes: string | null
  total_cents: number
  paid_cents: number
  debt_cents: number
  delivered_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type StoreSaleItemRow = StoreProductSnapshot & {
  id: string
  sale_id: string
  qty: number
  unit_price_cents: number
  line_total_cents: number
  stock_deducted: boolean
  created_at: string
  updated_at: string
}

export function isStoreCategory(value: unknown): value is StoreCategory {
  return typeof value === 'string' && (STORE_CATEGORIES as readonly string[]).includes(value)
}

export function isStorePaymentMethod(value: unknown): value is StorePaymentMethod {
  return typeof value === 'string' && (STORE_PAYMENT_METHODS as readonly string[]).includes(value)
}

export function isStoreSupplierOrderStatus(value: unknown): value is StoreSupplierOrderStatus {
  return typeof value === 'string' && (STORE_SUPPLIER_ORDER_STATUSES as readonly string[]).includes(value)
}

export function isStoreSupplierOrderItemStatus(value: unknown): value is StoreSupplierOrderItemStatus {
  return typeof value === 'string' && (STORE_SUPPLIER_ORDER_ITEM_STATUSES as readonly string[]).includes(value)
}

export function isStorePreorderStatus(value: unknown): value is StorePreorderStatus {
  return typeof value === 'string' && (STORE_PREORDER_STATUSES as readonly string[]).includes(value)
}

export function isStoreSaleStatus(value: unknown): value is StoreSaleStatus {
  return typeof value === 'string' && (STORE_SALE_STATUSES as readonly string[]).includes(value)
}
