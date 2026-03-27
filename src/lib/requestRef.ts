export function formatRequestRef(message: string, requestId?: string | null, style: 'dot' | 'paren' | 'sentence' = 'dot') {
  const base = String(message || '').trim()
  const ref = String(requestId || '').trim()
  if (!ref) return base
  if (style == 'paren') return `${base} (ref ${ref})`
  if (style == 'sentence') return `${base} Ref ${ref}.`
  return `${base} · Ref ${ref}`
}
