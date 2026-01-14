export function getAppUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_APP_URL || '').trim()
  if (raw) return raw.replace(/\/+$/, '')

  const vercel = (process.env.VERCEL_URL || '').trim()
  if (vercel) return `https://${vercel}`.replace(/\/+$/, '')

  return 'http://localhost:3000'
}
