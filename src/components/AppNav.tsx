// src/components/AppNav.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import Link from 'next/link'
import Image from 'next/image'
import { getSessionUser, type Role } from '@/lib/session'
import SignOutButton from '@/components/SignOutButton'
import NavLoginLink from '@/components/NavLoginLink'
import RoleMenu from '@/components/RoleMenu'
import HideMenuOnRoutes from '@/components/HideMenuOnRoutes'

type IconKey = 'dashboard' | 'bell' | 'gift' | 'id' | 'scan' | 'users' | 'user-cog' | 'bag' | 'wallet'
type MenuItem = { label: string; href: string; icon: IconKey }
type MenuByRole = Record<Role, MenuItem[]>

const MENU_BY_ROLE: MenuByRole = {
  member: [
    // { label: 'Store', href: '/store', icon: 'bag' },
    { label: 'Notifications', href: '/notifications', icon: 'bell' },
    { label: 'My Profile', href: '/profile', icon: 'id' },
    { label: 'Packages & Promos', href: '/packages-and-promos', icon: 'gift' },
    { label: 'Contact Admin', href: '/contact', icon: 'user-cog' },
  ],
  assistant_coach: [
    // { label: 'Store', href: '/store', icon: 'bag' },
    { label: 'Notifications', href: '/notifications', icon: 'bell' },
    { label: 'My Profile', href: '/profile', icon: 'id' },
    { label: 'Packages & Promos', href: '/packages-and-promos', icon: 'gift' },
  ],
  coach: [
    // { label: 'Store', href: '/store', icon: 'bag' },
    { label: 'Notifications', href: '/notifications', icon: 'bell' },
    { label: 'My Profile', href: '/profile', icon: 'id' },
    { label: 'Packages & Promos', href: '/packages-and-promos', icon: 'gift' },
  ],
  reception: [
    { label: 'Membership', href: '/kiosk', icon: 'id' },
    { label: 'Scan', href: '/scan', icon: 'scan' },
    { label: 'Members', href: '/members', icon: 'users' },
    { label: 'Packages & Promos', href: '/packages-and-promos', icon: 'gift' },
  ],
  admin: [
    { label: 'Dashboard', href: '/admin', icon: 'dashboard' },
    { label: 'Notifications', href: '/notifications', icon: 'bell' },
    { label: 'Packages & Promos', href: '/packages-and-promos', icon: 'gift' },
    { label: 'Membership', href: '/kiosk', icon: 'id' },
    { label: 'Scan', href: '/scan', icon: 'scan' },
    { label: 'Members', href: '/members', icon: 'users' },
    { label: 'Coaches', href: '/coaches', icon: 'user-cog' },
    // { label: 'Store', href: '/store', icon: 'bag' },
    { label: 'Expenses', href: '/expenses', icon: 'wallet' },
  ],
  super_admin: [
    { label: 'Dashboard', href: '/admin', icon: 'dashboard' },
    { label: 'Notifications', href: '/notifications', icon: 'bell' },
    { label: 'Packages & Promos', href: '/packages-and-promos', icon: 'gift' },
    { label: 'Membership', href: '/kiosk', icon: 'id' },
    { label: 'Scan', href: '/scan', icon: 'scan' },
    { label: 'Members', href: '/members', icon: 'users' },
    { label: 'Coaches', href: '/coaches', icon: 'user-cog' },
    // { label: 'Store', href: '/store', icon: 'bag' },
    { label: 'Expenses', href: '/expenses', icon: 'wallet' },
  ],
}

// ✅ Pages d’auth sur lesquelles on ne veut afficher ni Menu, ni Logout, ni lien Login
const AUTH_ROUTES = ['/login', '/signup', '/reset-password']

export default async function AppNav() {
  const user = await getSessionUser()
  const items = user ? (MENU_BY_ROLE[user.role] ?? []) : []

  return (
    <nav className="sticky top-0 z-30 border-b bg-white dark:bg-black">
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

        {/* Bouton Menu — caché sur "/" et sur les pages d’auth */}
        {user && (
          <HideMenuOnRoutes routes={['/', ...AUTH_ROUTES]}>
            <RoleMenu items={items} />
          </HideMenuOnRoutes>
        )}

        {/* Right side */}
        {user ? (
          // Cache l’info user + bouton logout sur les pages d’auth
          <HideMenuOnRoutes routes={AUTH_ROUTES}>
            <div className="ml-auto flex items-center gap-3">
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
