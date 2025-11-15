// src/lib/order.ts

// ---- Statuts de commande ----
export type OrderStatus = 'pending' | 'confirmed' | 'ready' | 'delivered' | 'canceled'
export const ORDER_STATUSES: OrderStatus[] = ['pending', 'confirmed', 'ready', 'delivered', 'canceled']

export function isOrderStatus(x: unknown): x is OrderStatus {
  return typeof x === 'string' && (ORDER_STATUSES as string[]).includes(x)
}

/**
 * Libellé lisible pour un statut (anglais).
 * Tu peux adapter ici si tu veux des libellés FR.
 */
export function humanStatus(s: OrderStatus): string {
  switch (s) {
    case 'pending':   return 'Pending'
    case 'confirmed': return 'Confirmed'
    case 'ready':     return 'Ready for pickup'
    case 'delivered': return 'Delivered'
    case 'canceled':  return 'Canceled'
    default:          return String(s)
  }
}

/**
 * Normalise une chaîne en statut valide (tolère quelques fautes courantes).
 * Renvoie null si non valide.
 */
export function normalizeStatus(input: string | null | undefined): OrderStatus | null {
  const v = String(input || '').trim().toLowerCase()
  const alias: Record<string, OrderStatus> = {
    delivere: 'delivered',
    deliverd: 'delivered',
    confirme: 'confirmed',
    confirmer: 'confirmed',
    pendingg: 'pending',
    cancel:   'canceled',
    cancelled:'canceled',
  }
  const candidate = (alias[v] ?? v) as OrderStatus
  return isOrderStatus(candidate) ? candidate : null
}

// ---- Moyens de paiement ----
export type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'instapay'
export const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'card', 'bank_transfer', 'instapay']

export function isPaymentMethod(x: unknown): x is PaymentMethod {
  return typeof x === 'string' && (PAYMENT_METHODS as string[]).includes(x)
}
