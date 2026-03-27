// src/components/AppNav.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import Image from 'next/image'
import { getSessionUser } from '@/lib/session'
import { getAppNavForRole, type NavIconKey as IconKey, type NavMenuItem as MenuItem } from '@/lib/rbac'
import SignOutButton from '@/components/SignOutButton'
import NavLoginLink from '@/components/NavLoginLink'
import RoleMenu from '@/components/RoleMenu'
import NotificationsBell from '@/components/NotificationsBell'
import HideMenuOnRoutes from '@/components/HideMenuOnRoutes'

// Pages d’auth sur lesquelles on ne veut afficher ni Menu, ni Logout, ni lien Login
const AUTH_ROUTES = ['/login', '/signup', '/reset-password']

export default async function AppNav() {
  const user = await getSessionUser()
  const items = user ? getAppNavForRole(user.role) : []
  const hasNotifications = items.some((it) => it.href === '/notifications')

  return (
    <nav className="app-nav sticky top-0 z-30 border-b bg-white dark:bg-black">
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-3 px-4">
        {/* Brand */}
        <Link href="/" className="group flex items-center gap-2" aria-label="ATOM Jiu-Jitsu">
          <Image
            src="/atom4app.png"
            alt="ATOM Jiu-Jitsu"
            width={112}
            height={28}
            priority
            className="h-7 w-auto transition-opacity group-hover:opacity-90 dark:hidden"
          />

          <span className="sr-only">ATOM Jiu-Jitsu</span>
        </Link>

        {/* Bouton Menu — visible sur Home, caché seulement sur les pages d’auth */}
        {user && (
          <HideMenuOnRoutes routes={AUTH_ROUTES}>
            <RoleMenu items={items} />
          </HideMenuOnRoutes>
        )}

        {/* Right side */}
        {user ? (
          // Cache l’info user + bouton logout sur les pages d’auth
          <HideMenuOnRoutes routes={AUTH_ROUTES}>
            <div className="ml-auto flex items-center gap-3">
              {hasNotifications ? <NotificationsBell pollMs={5000} /> : null}
              <span className="hidden text-xs text-gray-600 dark:text-gray-300 sm:inline">
                {user.full_name || user.email || 'User'} · <strong>{user.role}</strong>
              </span>
              <SignOutButton />
            </div>
          </HideMenuOnRoutes>
        ) : (
          // Cache le lien Login sur la page /login (sinon lien “Login” sur la page de login)
          <HideMenuOnRoutes routes={AUTH_ROUTES}>
            <div className="ml-auto">
              <NavLoginLink />
            </div>
          </HideMenuOnRoutes>
        )}
      </div>
    </nav>
  )
}

export type { MenuItem, IconKey }
