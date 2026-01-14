// src/app/page.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import type React from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { getSessionUser, type Role } from '@/lib/session'
import { createSupabaseRSC } from '@/lib/supabaseServer'

// Lucide icons
import {
  LayoutDashboard,
  Bell,
  Gift,
  IdCard,
  ScanLine,
  Users,
  UserCog,
  ShoppingBag,
  Wallet,
} from 'lucide-react'

type SessionUser = {
  id: string
  email: string | null
  role: Role
  first_name?: string | null
  last_name?: string | null
  id_photo_path?: string | null
}

function humanizeRole(role: string) {
  const s = role.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

async function getDisplayName(u: SessionUser): Promise<string> {
  const sessionName = [u.first_name ?? '', u.last_name ?? ''].join(' ').trim()
  if (sessionName) return sessionName

  try {
    const supabase = createSupabaseRSC()
    const { data } = await supabase
      .from('profiles')
      .select('first_name,last_name,email')
      .eq('user_id', u.id)
      .maybeSingle()

    if (data) {
      const fromDb = [data.first_name ?? '', data.last_name ?? ''].join(' ').trim()
      if (fromDb) return fromDb
      if (data.email) return data.email
    }
  } catch {}
  return u.email ?? humanizeRole(u.role)
}

type IconType = React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
type MenuItem = { label: string; href: string; desc?: string; icon: IconType }
type Section = { title: string; items: MenuItem[] }
type GroupedMenuByRole = Record<Role, Section[]>

/** Menus groupés par sections */
const MENU_BY_ROLE: GroupedMenuByRole = {
  member: [
    {
      title: 'My space',
      items: [
        { label: 'My Profile', href: '/profile', icon: IdCard },
        { label: 'Notifications', href: '/notifications', icon: Bell },
        { label: 'Store', href: '/store', icon: ShoppingBag },
        { label: 'Packages & Promos', href: '/packages-and-promos', icon: Gift },
      ],
    },
    { title: 'Support', items: [{ label: 'Contact Admin', href: '/contact', icon: UserCog }] },
  ],
  assistant_coach: [
    {
      title: 'Coach tools',
      items: [
        { label: 'My Profile', href: '/profile', icon: IdCard },
        { label: 'Notifications', href: '/notifications', icon: Bell },
        { label: 'Store', href: '/store', icon: ShoppingBag },
        { label: 'Packages & Promos', href: '/packages-and-promos', icon: Gift },
      ],
    },
  ],
  coach: [
    {
      title: 'Coach tools',
      items: [
        { label: 'My Profile', href: '/profile', icon: IdCard },
        { label: 'Notifications', href: '/notifications', icon: Bell },
        { label: 'Store', href: '/store', icon: ShoppingBag },
        { label: 'Packages & Promos', href: '/packages-and-promos', icon: Gift },
      ],
    },
  ],
  reception: [
    {
      title: 'Front desk',
      items: [
        { label: 'Membership', href: '/kiosk', icon: IdCard },
        { label: 'Scan', href: '/scan', icon: ScanLine },
        { label: 'Members', href: '/members', icon: Users },
        { label: 'Packages & Promos', href: '/packages-and-promos', icon: Gift },
      ],
    },
  ],
  admin: [
    {
      title: 'Overview',
      items: [
        { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
        { label: 'Notifications', href: '/notifications', icon: Bell },
      ],
    },
    {
      title: 'Operations',
      items: [
        { label: 'Packages & Promos', href: '/packages-and-promos', icon: Gift },
        { label: 'Membership', href: '/kiosk', icon: IdCard },
        { label: 'Scan', href: '/scan', icon: ScanLine },
      ],
    },
    {
      title: 'People',
      items: [
        { label: 'Members', href: '/members', icon: Users },
        { label: 'Coaches', href: '/coaches', icon: UserCog },
      ],
    },
    {
      title: 'Store & Finance',
      items: [
        { label: 'Store', href: '/store', icon: ShoppingBag },
        { label: 'Expenses', href: '/expenses', icon: Wallet },
      ],
    },
  ],
  super_admin: [
    {
      title: 'Overview',
      items: [
        { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
        { label: 'Notifications', href: '/notifications', icon: Bell },
      ],
    },
    {
      title: 'Operations',
      items: [
        { label: 'Packages & Promos', href: '/packages-and-promos', icon: Gift },
        { label: 'Membership', href: '/kiosk', icon: IdCard },
        { label: 'Scan', href: '/scan', icon: ScanLine },
      ],
    },
    {
      title: 'People',
      items: [
        { label: 'Members', href: '/members', icon: Users },
        { label: 'Coaches', href: '/coaches', icon: UserCog },
      ],
    },
    {
      title: 'Store & Finance',
      items: [
        { label: 'Store', href: '/store', icon: ShoppingBag },
        { label: 'Expenses', href: '/expenses', icon: Wallet },
      ],
    },
  ],
}

function SectionGrid({ section }: { section: Section }) {
  const items = section.items ?? []
  if (!items.length) return null
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold tracking-wide text-[hsl(var(--muted))]">
        {section.title}
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => {
          const Icon = it.icon
          return (
            <Link
              key={it.href}
              href={it.href}
              className="group block rounded-2xl border border-[hsl(var(--border))] bg-white p-5 shadow-soft transition ease-soft hover:shadow-md hover:shadow-black/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold tracking-tight">{it.label}</h3>
                <span
                  aria-hidden
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[hsl(var(--border))] transition group-hover:translate-x-0.5"
                >
                  <Icon size={18} strokeWidth={2.2} className="text-black" />
                </span>
              </div>
              {it.desc && <p className="mt-1 text-sm text-[hsl(var(--muted))]">{it.desc}</p>}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

export default async function HomePage() {
  const user = (await getSessionUser()) as SessionUser | null
  const displayName = user ? await getDisplayName(user) : null
  const role: Role | null = user?.role ?? null
  const grouped = role ? MENU_BY_ROLE[role] : []

  // Avatar signé (RSC) — uniquement pour member / coach / assistant_coach
  let signedAvatar = ''
  const canShowAvatar =
    !!user &&
    ['member', 'coach', 'assistant_coach'].includes(user.role) &&
    !!user.id_photo_path

  if (canShowAvatar && user?.id_photo_path) {
    const supabase = createSupabaseRSC()
    const { data } = await supabase
      .storage
      .from('id-photos')
      .createSignedUrl(user.id_photo_path, 60 * 10)
    signedAvatar = data?.signedUrl || ''
  }

  return (
    <main className="min-h-[calc(100vh-3rem)] bg-white text-black">
      <section className="mx-auto max-w-6xl px-4 py-8 space-y-6">
        {user ? (
          <>
            {/* Header avec avatar au-dessus du rôle */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  Welcome, {displayName}
                </h1>
              </div>

              <div className="flex flex-col items-end gap-2">
                {canShowAvatar && signedAvatar ? (
                  <div className="relative h-16 w-16 sm:h-20 sm:w-20 lg:h-24 lg:w-24 overflow-hidden rounded-full border ring-1 ring-[hsl(var(--border))] bg-white shadow-soft">
                    <Image
                      src={signedAvatar}
                      alt="Profile photo"
                      fill
                      className="object-cover"
                    />
                  </div>
                ) : null}
              </div>
            </div>

            {/* Sections groupées */}
            <div className="space-y-8">
              {grouped.map((section) => (
                <SectionGrid key={section.title} section={section} />
              ))}
            </div>
          </>
        ) : (
          <p className="mt-6 text-gray-500">Please sign in to see your menu.</p>
        )}
      </section>

      <footer className="mx-auto max-w-6xl px-4 pb-10 pt-2 text-xs text-gray-500">
        © {new Date().getFullYear()} ATOM Jiu-Jitsu
      </footer>
    </main>
  )
}
