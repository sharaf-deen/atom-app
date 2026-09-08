'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Circle,
  FileText,
  Gift,
  House,
  IdCard,
  LayoutDashboard,
  Menu as MenuIcon,
  ScanLine,
  Search,
  ShoppingBag,
  UserCog,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { IconKey, MenuItem } from './AppNav'
import type { Role } from '@/lib/rbac'

const ICONS: Record<IconKey, LucideIcon> = {
  home: House,
  dashboard: LayoutDashboard,
  bell: Bell,
  gift: Gift,
  id: IdCard,
  scan: ScanLine,
  users: Users,
  'user-cog': UserCog,
  bag: ShoppingBag,
  wallet: Wallet,
  calendar: CalendarDays,
  'file-text': FileText,
}

const VISIBLE_POLL_MS = 5_000
const HIDDEN_POLL_MS = 30_000

const STRUCTURED_ROLES: Role[] = ['reception', 'admin', 'super_admin']
const LITE_MENU_ROLES: Role[] = [
  'member',
  'champion',
  'vip',
  'assistant_coach',
  'coach',
  'head_coach',
]

const QUICK_MAX = 6

type SectionKey =
  | 'overview'
  | 'members'
  | 'training'
  | 'finance'
  | 'store'
  | 'administration'

type NavSection = {
  key: SectionKey
  label: string
  items: MenuItem[]
}

const SECTION_ORDER: Array<{ key: SectionKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'members', label: 'Members' },
  { key: 'training', label: 'Training' },
  { key: 'finance', label: 'Finance' },
  { key: 'store', label: 'Store' },
  { key: 'administration', label: 'Administration' },
]

function uniqByHref(items: MenuItem[]) {
  const out: MenuItem[] = []
  const seen = new Set<string>()

  for (const item of items) {
    if (seen.has(item.href)) continue
    seen.add(item.href)
    out.push(item)
  }

  return out
}

function normalizeMenuItems(items: MenuItem[]) {
  return uniqByHref(
    items.map((item) =>
      item.href === '/store/admin'
        ? { ...item, href: '/admin/store/dashboard' }
        : item
    )
  )
}

function pickQuick(items: MenuItem[]) {
  const priority = [
    '/admin',
    '/reception',
    '/members',
    '/admin/members/family-operations',
    '/admin/payments',
    '/schedule/operations',
    '/admin/private-coaching',
    '/admin/store/dashboard',
    '/scan',
    '/notifications',
    '/schedule',
    '/profile',
  ]

  const byHref = new Map(items.map((item) => [item.href, item] as const))
  const quick: MenuItem[] = []

  for (const href of priority) {
    const item = byHref.get(href)
    if (!item) continue
    if (quick.some((existing) => existing.href === item.href)) continue

    quick.push(item)
    if (quick.length >= QUICK_MAX) break
  }

  if (quick.length < Math.min(QUICK_MAX, items.length)) {
    for (const item of items) {
      if (quick.length >= QUICK_MAX) break
      if (quick.some((existing) => existing.href === item.href)) continue
      quick.push(item)
    }
  }

  return quick
}

function sectionFor(item: MenuItem): SectionKey {
  const href = item.href
  const label = item.label.toLowerCase()

  if (
    href === '/' ||
    href === '/admin' ||
    href === '/reception' ||
    href === '/notifications' ||
    href === '/profile'
  ) {
    return 'overview'
  }

  if (
    href === '/members' ||
    href === '/kiosk' ||
    href === '/scan' ||
    href === '/coaches' ||
    href === '/head-coach/athletes' ||
    href.startsWith('/admin/members/') ||
    href.startsWith('/admin/crm') ||
    href.startsWith('/admin/visitors') ||
    href.startsWith('/admin/freeze-requests') ||
    href.startsWith('/admin/expiring-soon') ||
    href.startsWith('/admin/membership-activity') ||
    label.includes('member') ||
    label.includes('family') ||
    label.includes('visitor')
  ) {
    return 'members'
  }

  if (
    href === '/schedule' ||
    href.startsWith('/schedule/') ||
    href.startsWith('/coach-operations/') ||
    href.startsWith('/admin/private-coaching') ||
    href.startsWith('/head-coach/private-coaching') ||
    href.startsWith('/private-coaching') ||
    href.startsWith('/admin/attendance')
  ) {
    return 'training'
  }

  if (
    href === '/invoices' ||
    href === '/expenses' ||
    href.startsWith('/admin/payments') ||
    href.startsWith('/admin/membership-refunds') ||
    href.startsWith('/admin/cash-report') ||
    href.startsWith('/admin/outstanding-dues') ||
    href.startsWith('/admin/external-income') ||
    label.includes('payment') ||
    label.includes('refund') ||
    label.includes('cash') ||
    label.includes('expense') ||
    label.includes('income') ||
    label.includes('invoice')
  ) {
    return 'finance'
  }

  if (
    href === '/store' ||
    href.startsWith('/admin/store') ||
    href === '/packages-and-promos' ||
    label.includes('store') ||
    label.includes('package') ||
    label.includes('promo')
  ) {
    return 'store'
  }

  return 'administration'
}

function groupItems(items: MenuItem[]): NavSection[] {
  const groups = new Map<SectionKey, MenuItem[]>()

  for (const item of items) {
    const key = sectionFor(item)
    const current = groups.get(key) ?? []
    current.push(item)
    groups.set(key, current)
  }

  return SECTION_ORDER.flatMap(({ key, label }) => {
    const sectionItems = groups.get(key) ?? []
    return sectionItems.length ? [{ key, label, items: sectionItems }] : []
  })
}

function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return

    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previous
    }
  }, [locked])
}

function roleLabel(role?: Role) {
  if (role === 'super_admin') return 'Super Admin'
  if (role === 'admin') return 'Admin'
  if (role === 'reception') return 'Reception'
  if (role === 'head_coach') return 'Head Coach'
  if (role === 'assistant_coach') return 'Assistant Coach'
  if (role === 'coach') return 'Coach'
  if (role === 'champion') return 'Champion'
  if (role === 'vip') return 'VIP'
  return 'Member'
}

function itemIsActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  if (href === '/admin') return pathname === '/admin'
  if (href === '/store') return pathname === '/store'
  if (href === '/schedule') return pathname === '/schedule'
  if (href === '/members') return pathname === '/members'
  if (href === '/reception') return pathname === '/reception'
  if (href === '/profile') return pathname === '/profile'

  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function RoleMenu({
  items,
  role,
}: {
  items: MenuItem[]
  role?: Role
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [openSections, setOpenSections] = useState<Set<SectionKey>>(
    () => new Set<SectionKey>(['overview'])
  )

  const panelRef = useRef<HTMLDivElement | null>(null)

  const menuItems = useMemo(() => normalizeMenuItems(items), [items])
  const quickItems = useMemo(() => pickQuick(menuItems), [menuItems])
  const sections = useMemo(() => groupItems(menuItems), [menuItems])

  const isStructuredRole = !!role && STRUCTURED_ROLES.includes(role)
  const isLiteMenu = !!role && LITE_MENU_ROLES.includes(role)

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return menuItems

    return menuItems.filter((item) =>
      `${item.label} ${item.href}`.toLowerCase().includes(normalizedQuery)
    )
  }, [menuItems, query])

  const hasNotifications = useMemo(
    () => menuItems.some((item) => item.href === '/notifications'),
    [menuItems]
  )

  const [unreadCount, setUnreadCount] = useState(0)
  const timerRef = useRef<number | null>(null)
  const inFlightRef = useRef(false)

  useBodyScrollLock(open)

  async function refreshUnread() {
    if (!hasNotifications) {
      setUnreadCount(0)
      return
    }
    if (inFlightRef.current) return

    inFlightRef.current = true

    try {
      const response = await fetch('/api/notifications/unread-count', {
        cache: 'no-store',
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.ok) return
      setUnreadCount(Number(payload.count || 0))
    } catch {
      // Keep navigation usable if notification polling fails.
    } finally {
      inFlightRef.current = false
    }
  }

  function currentPollMs() {
    const visible =
      typeof document !== 'undefined' &&
      document.visibilityState === 'visible'

    return visible ? VISIBLE_POLL_MS : HIDDEN_POLL_MS
  }

  function setTimer(ms: number) {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
    }

    timerRef.current = null

    if (!hasNotifications) return
    if (ms > 0) {
      timerRef.current = window.setInterval(refreshUnread, ms)
    }
  }

  useEffect(() => {
    refreshUnread()
    setTimer(currentPollMs())

    const onUpdate = () => refreshUnread()

    function onVisibility() {
      if (document.visibilityState === 'visible') {
        refreshUnread()
      }
      setTimer(currentPollMs())
    }

    window.addEventListener('notifications:updated', onUpdate)
    window.addEventListener('atom:notifications:changed', onUpdate as any)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onVisibility)

    return () => {
      window.removeEventListener('notifications:updated', onUpdate)
      window.removeEventListener(
        'atom:notifications:changed',
        onUpdate as any
      )
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)

      if (timerRef.current) {
        window.clearInterval(timerRef.current)
      }

      timerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNotifications])

  useEffect(() => {
    if (open) {
      refreshUnread()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    setOpen(false)
    setQuery('')
  }, [pathname])

  useEffect(() => {
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        setQuery('')
      }
    }

    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [])

  function close() {
    setOpen(false)
    setQuery('')
  }

  function toggleSection(key: SectionKey) {
    setOpenSections((current) => {
      const next = new Set(current)

      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }

      return next
    })
  }

  function MenuItemLink({
    item,
    compact = false,
  }: {
    item: MenuItem
    compact?: boolean
  }) {
    const Icon = ICONS[item.icon] ?? Circle
    const notificationUnread =
      item.href === '/notifications' && unreadCount > 0
    const active = itemIsActive(pathname, item.href)

    return (
      <Link
        href={item.href}
        onClick={close}
        className={
          'group flex min-w-0 items-center justify-between gap-3 rounded-2xl outline-none transition ' +
          (compact ? 'px-3 py-2.5 text-sm ' : 'px-3 py-3 text-[15px] ') +
          (active
            ? 'bg-black text-white dark:bg-white dark:text-black '
            : 'hover:bg-black/[0.04] focus:bg-black/[0.05] dark:hover:bg-white/[0.07] dark:focus:bg-white/[0.09] ') +
          (notificationUnread && !active ? 'font-semibold text-red-700 ' : '')
        }
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={
              'inline-flex shrink-0 items-center justify-center rounded-xl border ' +
              (compact ? 'h-8 w-8 ' : 'h-9 w-9 ') +
              (active
                ? 'border-white/20 bg-white/10 dark:border-black/10 dark:bg-black/5 '
                : notificationUnread
                  ? 'border-red-200 bg-red-50 dark:border-white/10 dark:bg-white/10 '
                  : 'border-black/10 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.04] ')
            }
          >
            <Icon
              size={17}
              strokeWidth={2.2}
              className={
                active
                  ? 'text-white dark:text-black'
                  : notificationUnread
                    ? 'text-red-700'
                    : 'text-black dark:text-white'
              }
            />
          </span>

          <span className="truncate">{item.label}</span>
        </div>

        {notificationUnread ? (
          <span
            className={
              'inline-flex h-6 min-w-[24px] shrink-0 items-center justify-center rounded-full px-2 text-xs font-bold ' +
              (active
                ? 'bg-white text-black dark:bg-black dark:text-white'
                : 'bg-red-600 text-white')
            }
            aria-label={`${unreadCount} unread notifications`}
            title={`${unreadCount} unread notifications`}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </Link>
    )
  }

  function StructuredNavigation() {
    return (
      <>
        <div
          className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[1px]"
          aria-hidden
          onClick={close}
        />

        <aside
          role="dialog"
          aria-modal="true"
          aria-label={`${roleLabel(role)} navigation`}
          className="fixed inset-y-0 left-0 z-50 flex w-full flex-col border-r border-black/10 bg-white shadow-2xl dark:border-white/10 dark:bg-black sm:w-[380px]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-black/10 px-4 py-4 dark:border-white/10">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-black/50 dark:text-white/50">
                ATOM Operations
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="truncate text-lg font-semibold">
                  {roleLabel(role)}
                </div>
                <span className="rounded-full bg-black px-2 py-0.5 text-[10px] font-semibold text-white dark:bg-white dark:text-black">
                  {menuItems.length} tools
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={close}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/10 hover:bg-black/[0.04] dark:border-white/10 dark:hover:bg-white/[0.07]"
              aria-label="Close navigation"
            >
              <X size={19} />
            </button>
          </div>

          <div className="border-b border-black/10 p-4 dark:border-white/10">
            <div className="relative">
              <Search
                size={17}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black/45 dark:text-white/45"
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search pages…"
                className="w-full rounded-2xl border border-black/10 bg-black/[0.02] py-2.5 pl-10 pr-10 text-sm outline-none transition focus:border-black/30 focus:bg-white focus:ring-2 focus:ring-black/5 dark:border-white/10 dark:bg-white/[0.04] dark:focus:border-white/30 dark:focus:bg-black dark:focus:ring-white/10"
                autoFocus
              />

              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full hover:bg-black/[0.04] dark:hover:bg-white/[0.07]"
                  aria-label="Clear search"
                >
                  <X size={15} />
                </button>
              ) : null}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {query.trim() ? (
              <div className="p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-black/45 dark:text-white/45">
                    Search results
                  </div>
                  <div className="text-xs text-black/45 dark:text-white/45">
                    {filteredItems.length}
                  </div>
                </div>

                {filteredItems.length ? (
                  <nav className="space-y-1">
                    {filteredItems.map((item) => (
                      <MenuItemLink key={item.href} item={item} compact />
                    ))}
                  </nav>
                ) : (
                  <div className="rounded-2xl border border-dashed border-black/10 px-4 py-6 text-center text-sm text-black/50 dark:border-white/10 dark:text-white/50">
                    No page matches “{query.trim()}”.
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-5 p-4">
                <section>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-black/45 dark:text-white/45">
                    Quick Access
                  </div>

                  <nav className="grid grid-cols-2 gap-2">
                    {quickItems.map((item) => (
                      <MenuItemLink key={item.href} item={item} compact />
                    ))}
                  </nav>
                </section>

                <section>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-black/45 dark:text-white/45">
                    All tools
                  </div>

                  <div className="space-y-2">
                    {sections.map((section) => {
                      const expanded = openSections.has(section.key)

                      return (
                        <div
                          key={section.key}
                          className="overflow-hidden rounded-2xl border border-black/10 dark:border-white/10"
                        >
                          <button
                            type="button"
                            onClick={() => toggleSection(section.key)}
                            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-black/[0.025] dark:hover:bg-white/[0.05]"
                            aria-expanded={expanded}
                          >
                            <div>
                              <div className="text-sm font-semibold">
                                {section.label}
                              </div>
                              <div className="mt-0.5 text-xs text-black/45 dark:text-white/45">
                                {section.items.length}{' '}
                                {section.items.length === 1 ? 'tool' : 'tools'}
                              </div>
                            </div>

                            <ChevronRight
                              size={18}
                              className={
                                'shrink-0 transition-transform ' +
                                (expanded ? 'rotate-90' : '')
                              }
                            />
                          </button>

                          {expanded ? (
                            <nav className="space-y-1 border-t border-black/10 p-2 dark:border-white/10">
                              {section.items.map((item) => (
                                <MenuItemLink
                                  key={item.href}
                                  item={item}
                                  compact
                                />
                              ))}
                            </nav>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </section>
              </div>
            )}
          </div>

          <div className="border-t border-black/10 px-4 py-3 dark:border-white/10">
            <div className="flex items-center justify-between gap-3 text-xs text-black/50 dark:text-white/50">
              <span>Role-aware navigation</span>
              <span>Esc to close</span>
            </div>
          </div>
        </aside>
      </>
    )
  }

  function CompactNavigation() {
    return (
      <>
        <div
          className="fixed inset-0 z-40 bg-black/40"
          aria-hidden
          onClick={close}
        />

        <div className="fixed inset-x-0 bottom-0 z-50 sm:hidden">
          <div className="mx-auto w-full max-w-md rounded-t-[28px] border border-black/10 bg-white shadow-2xl dark:border-white/10 dark:bg-black">
            <div className="flex items-center justify-center pt-2">
              <div className="h-1.5 w-12 rounded-full bg-black/20 dark:bg-white/20" />
            </div>

            <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
              <div className="text-base font-semibold">
                {roleLabel(role)} Menu
              </div>
              <button
                type="button"
                onClick={close}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/10 hover:bg-black/[0.03] dark:border-white/10 dark:hover:bg-white/[0.06]"
                aria-label="Close menu"
              >
                <X size={18} />
              </button>
            </div>

            <nav className="max-h-[70vh] space-y-1 overflow-y-auto px-2 pb-4">
              {menuItems.map((item) => (
                <MenuItemLink key={item.href} item={item} />
              ))}
            </nav>
          </div>
        </div>

        <div
          ref={panelRef}
          className="absolute z-50 mt-3 hidden w-72 rounded-3xl border border-black/10 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-black sm:block"
        >
          <div className="flex items-center justify-between gap-2 px-2 py-2">
            <div className="text-sm font-semibold">
              {isLiteMenu ? 'Menu' : roleLabel(role)}
            </div>
            <button
              type="button"
              onClick={close}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/10 hover:bg-black/[0.03] dark:border-white/10 dark:hover:bg-white/[0.06]"
              aria-label="Close menu"
            >
              <X size={16} />
            </button>
          </div>

          <nav className="max-h-[70vh] space-y-1 overflow-y-auto">
            {menuItems.map((item) => (
              <MenuItemLink key={item.href} item={item} compact />
            ))}
          </nav>
        </div>
      </>
    )
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="relative rounded-full border border-black bg-black px-4 py-2 text-sm font-semibold text-white shadow-soft transition hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-black/60 dark:border-white dark:bg-white dark:text-black dark:focus:ring-white/60"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Open navigation"
      >
        <span className="inline-flex items-center gap-2">
          <MenuIcon size={16} />
          Menu
          {!isStructuredRole ? (
            <ChevronDown
              size={15}
              className={
                'transition-transform ' + (open ? 'rotate-180' : '')
              }
            />
          ) : null}
        </span>
      </button>

      {open
        ? isStructuredRole
          ? <StructuredNavigation />
          : <CompactNavigation />
        : null}
    </div>
  )
}
