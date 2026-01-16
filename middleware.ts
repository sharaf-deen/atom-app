// middleware.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

function buildNext(req: NextRequest) {
  // pathname + querystring (pas de hash côté serveur)
  const p = req.nextUrl.pathname
  const s = req.nextUrl.search || ''
  return `${p}${s}` || '/'
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Routes protégées (auth obligatoire)
  const protectedPaths = [/^\/admin(?:\/|$)/, /^\/scan(?:\/|$)/, /^\/kiosk(?:\/|$)/]
  const needsAuth = protectedPaths.some((re) => re.test(pathname))

  if (!needsAuth) return NextResponse.next()

  // On capture les opérations cookies (car on peut retourner redirect ou next)
  const cookieOps: Array<
    | { type: 'set'; name: string; value: string; options: any }
    | { type: 'remove'; name: string; options: any }
  > = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => req.cookies.get(name)?.value,
        set: (name: string, value: string, options: any) => {
          cookieOps.push({ type: 'set', name, value, options })
        },
        remove: (name: string, options: any) => {
          cookieOps.push({ type: 'remove', name, options })
        },
      },
    }
  )

  // Vérifie la session (peut déclencher refresh cookies)
  const {
    data: { session },
  } = await supabase.auth.getSession()

  // Fabrique la réponse finale + applique les cookies capturés
  const applyCookies = (res: NextResponse) => {
    for (const op of cookieOps) {
      if (op.type === 'set') {
        res.cookies.set({ name: op.name, value: op.value, ...op.options })
      } else {
        res.cookies.set({ name: op.name, value: '', ...op.options, maxAge: 0 })
      }
    }
    return res
  }

  if (!session) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', buildNext(req))

    return applyCookies(NextResponse.redirect(url))
  }

  return applyCookies(NextResponse.next())
}

// Limiter le middleware aux routes utiles (inclut sous-routes)
export const config = {
  matcher: ['/admin/:path*', '/scan/:path*', '/kiosk/:path*'],
}
