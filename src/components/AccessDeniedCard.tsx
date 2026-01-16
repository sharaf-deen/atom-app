import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/Card'

function safeNext(nextPath?: string) {
  if (!nextPath) return '/'
  if (nextPath.startsWith('/') && !nextPath.startsWith('//')) return nextPath
  return '/'
}

export default function AccessDeniedCard({
  title = 'Forbidden',
  message = "You don’t have permission to view this page.",
  nextPath = '/',
  showBackHome = true,
}: {
  title?: string
  message?: string
  nextPath?: string
  showBackHome?: boolean
}) {
  const next = safeNext(nextPath)
  const href = `/logout?next=${encodeURIComponent(next)}`

  return (
    <Card>
      <CardContent>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">{message}</p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={href}
            className="inline-flex items-center justify-center rounded-2xl shadow-soft transition ease-soft px-4 py-2 text-sm bg-white text-black border border-[hsl(var(--border))] hover:bg-[hsl(var(--bg))]/80"
          >
            Switch account
          </Link>

          {showBackHome && (
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-2xl shadow-soft transition ease-soft px-4 py-2 text-sm bg-transparent text-black hover:bg-black/5"
            >
              Back to home
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
