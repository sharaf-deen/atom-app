// middleware.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

type Role =
  | 'member'
  | 'assistant_coach'
  | 'coach'
  | 'reception'
  | 'admin'
  | 'super_admin'

function buildNext(req: NextRequest) {
  const p = req.nextUrl.pathname
  const s = req.nextUrl.search || ''
  return `${p}${s}` || '/'
}

function isAdmin(role?: Role | null) {
  return role === 'admin' || role === 'super_admin'
}
function isStaff(role?: Role | null) {
  return role === 'reception' || role === 'admin' || role === 'super_admin'
}
function isSuperAdmin(role?: Role | null) {
  return role === 'super_admin'
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // --- ROUTE RULES -----------------------------------------------------------
  // 1) Must be logged in
  const authRequired = [
    /^\/admin(?:\/|$)/,
    /^\/scan(?:\/|$)/,
    /^\/kiosk(?:\/|$)/,
    /^\/members(?:\/|$)/,
    /^\/packages-and-promos(?:\/|$)/,
  ].some((re) => re.test(pathname))

  if (!authRequired) return NextResponse.next()

  // Capture cookie ops (refresh tokens etc.)
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

  const {
    data: { session },
  } = await supabase.auth.getSession()

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

  // Not logged in -> login with next=
  if (!session) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', buildNext(req))
    return applyCookies(NextResponse.redirect(url))
  }

  // --- ROLE CHECK ------------------------------------------------------------
  // Fetch role from profiles (server-side, respects RLS for the logged in user)
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', session.user.id)
    .maybeSingle<{ role: Role | null }>()

  const role = (profile?.role ?? 'member') as Role
  const uid = session.user.id

  // Determine if current route is allowed.
  let allowed = true

  // /admin and subroutes -> admin or super_admin
  if (/^\/admin(?:\/|$)/.test(pathname)) {
    allowed = isAdmin(role)
  }

  // /scan + /kiosk -> staff
  if (/^\/scan(?:\/|$)/.test(pathname) || /^\/kiosk(?:\/|$)/.test(pathname)) {
    allowed = isStaff(role)
  }

  // /members -> staff
  if (/^\/members(?:\/|$)/.test(pathname)) {
    // Special case: /members/[id] : allow self even if not staff
    const m = pathname.match(/^\/members\/([^/]+)(?:\/|$)/)
    const memberId = m?.[1]
    if (memberId && memberId !== 'new') {
      allowed = isStaff(role) || memberId === uid
    } else {
      allowed = isStaff(role)
    }
  }

  // /packages-and-promos
  if (/^\/packages-and-promos(?:\/|$)/.test(pathname)) {
    // base page -> any logged-in user (already ensured)
    allowed = true

    // /packages-and-promos/new -> super_admin only
    if (/^\/packages-and-promos\/new(?:\/|$)/.test(pathname)) {
      allowed = isSuperAdmin(role)
    }

    // /packages-and-promos/:id/edit -> super_admin only
    if (/^\/packages-and-promos\/[^/]+\/edit(?:\/|$)/.test(pathname)) {
      allowed = isSuperAdmin(role)
    }
  }

  if (!allowed) {
    // We do NOT redirect (to avoid loops & preserve UX pages).
    // We let the page render its AccessDenied UI, but we *can* block server actions.
    // For pages, allow NextResponse.next().
    return applyCookies(NextResponse.next())
  }

  return applyCookies(NextResponse.next())
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/scan/:path*',
    '/kiosk/:path*',
    '/members/:path*',
    '/packages-and-promos/:path*',
  ],
}
