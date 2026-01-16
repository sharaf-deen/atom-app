import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/Card'

type Action = { href: string; label: string }

function safeNext(nextPath?: string) {
  if (!nextPath) return '/'
  const n = nextPath.trim()
  if (!n.startsWith('/')) return '/'
  if (n.startsWith('//')) return '/'
  if (n.includes('://')) return '/'
  if (n.includes('\\')) return '/'
  return n || '/'
}

export default function AccessDeniedCard({
  signedInAs,
  title = 'Forbidden',
  message = "You don’t have permission to view this page.",
  allowed,
  nextPath = '/',
  actions = [],
  showBackHome = true,
  showProfile = false,
}: {
  signedInAs?: string | null
  title?: string
  message?: string
  allowed?: string
  nextPath?: string
  actions?: Action[]
  showBackHome?: boolean
  showProfile?: boolean
}) {
  const next = safeNext(nextPath)
  const switchHref = `/logout?next=${encodeURIComponent(next)}`

  const btn =
    'inline-flex items-center justify-center rounded-2xl shadow-soft transition ease-soft px-4 py-2 text-sm bg-white text-black border border-[hsl(var(--border))] hover:bg-[hsl(var(--bg))]/80'

  const btnGhost =
    'inline-flex items-center justify-center rounded-2xl shadow-soft transition ease-soft px-4 py-2 text-sm bg-transparent text-black hover:bg-black/5'

  return (
    <Card>
      <CardContent>
        {signedInAs ? (
          <div className="text-sm text-[hsl(var(--muted))] mb-2">
            Signed in as <span className="font-medium">{signedInAs}</span>
          </div>
        ) : null}

        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted))]">{message}</p>

        {allowed ? (
          <p className="mt-2 text-sm text-[hsl(var(--muted))]">
            Allowed: <span className="font-medium">{allowed}</span>
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={switchHref} className={btn}>
            Switch account
          </Link>

          {showBackHome && (
            <Link href="/" className={btnGhost}>
              Back to home
            </Link>
          )}

          {showProfile && (
            <Link href="/profile" className={btnGhost}>
              My profile
            </Link>
          )}

          {actions.map((a) => (
            <Link key={a.href + a.label} href={a.href} className={btnGhost}>
              {a.label}
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
