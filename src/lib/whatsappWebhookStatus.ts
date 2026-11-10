/** Legal previous statuses for a WhatsApp delivery event.
 * Updates use this list as a database WHERE condition, not only as a
 * JavaScript pre-check, to avoid out-of-order webhook races.
 */
export function allowedWhatsAppPriorStatuses(next: string): string[] {
  switch (next) {
    case 'sent': return ['queued', 'sending', 'sent']
    case 'delivered': return ['queued', 'sending', 'sent', 'delivered']
    case 'read': return ['queued', 'sending', 'sent', 'delivered', 'read']
    case 'failed': return ['queued', 'sending', 'sent', 'failed']
    default: return []
  }
}
