'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronUp,
  ChevronDown,
  LayoutDashboard,
  Bell,
  Gift,
  IdCard,
  ScanLine,
  Users,
  UserCog,
  ShoppingBag,
  Wallet,
  CalendarDays,
  FileText,
  House,
  Circle,
  Search,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { IconKey, MenuItem } from './AppNav'

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

// Keep the dropdown short by default (admins can have a lot of items).
const QUICK_MAX = 7

function uniqByHref(items: MenuItem[]) {
  const out: MenuItem[] = []
  const seen = new Set<string>()
  for (const it of items) {
    if (seen.has(it.href)) continue
    seen.add(it.href)
    out.push(it)
  }
  return out
}

function pickQuick(items: MenuItem[]) {
  const priority = [
    '/admin',
    '/members',
    '/scan',
    '/admin/expiring-soon',
    '/admin/attendance',
    '/admin/outstanding-dues',
    '/admin/cash-report',
    '/admin/payments',
    '/expenses',
    '/notifications',
    '/schedule',
    '/store',
    '/profile',
    '/packages-and-promos',
  ]

  const byHref = new Map(items.map((it) => [it.href, it] as const))
  const quick: MenuItem[] = []

  for (const href of priority) {
    const it = byHref.get(href)
    if (!it) continue
    if (quick.some((q) => q.href === it.href)) continue
    quick.push(it)
    if (quick.length >= QUICK_MAX) break
  }

  // Ensure Notifications is always visible if present
  const notif = byHref.get('/notifications')
  if (notif && !quick.some((q) => q.href === '/notifications')) {
    if (quick.length >= QUICK_MAX) quick.pop()
    quick.push(notif)
  }

  // If still short, fill with first items (stable)
  if (quick.length < Math.min(QUICK_MAX, items.length)) {
    for (const it of items) {
      if (quick.length >= QUICK_MAX) break
      if (quick.some((q) => q.href === it.href)) continue
      quick.push(it)
    }
  }

  return quick
}

export default function RoleMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [q, setQ] = useState('')
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Normalize legacy routes: remove /store/admin from the menu (use /admin/store instead)
  // Also de-duplicate by href in case both exist.
  const menuItems = useMemo(() => {
    const mapped = items.map((it) => (it.href === '/store/admin' ? { ...it, href: '/admin/store' } : it))
    return uniqByHref(mapped)
  }, [items])

  const quickItems = useMemo(() => pickQuick(menuItems), [menuItems])

  const hasNotifications = useMemo(() => menuItems.some((it) => it.href === '/notifications'), [menuItems])
  const [unreadCount, setUnreadCount] = useState<number>(0)
  const timerRef = useRef<number | null>(null)
  const inFlightRef = useRef(false)

  async function refreshUnread() {
    if (!hasNotifications) {
      setUnreadCount(0)
      return
    }
    if (inFlightRef.current) return
    inFlightRef.current = true
    try {
      const r = await fetch('/api/notifications/unread-count', { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) return
      setUnreadCount(Number(j.count || 0))
    } catch {
      // ignore
    } finally {
      inFlightRef.current = false
    }
  }

  function currentPollMs() {
    const visible = typeof document !== 'undefined' && document.visibilityState === 'visible'
    return visible ? VISIBLE_POLL_MS : HIDDEN_POLL_MS
  }

  function setTimer(ms: number) {
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = null
    if (!hasNotifications) return
    if (ms > 0) timerRef.current = window.setInterval(refreshUnread, ms)
  }

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!open) return
      const t = e.target as Node
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
      setShowAll(false)
      setQ('')
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        setShowAll(false)
        setQ('')
      }
    }
    window.addEventListener('click', onClick)
    window.addEventListener('keydown', onEsc)
    return () => {
      window.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onEsc)
    }
  }, [open])

  useEffect(() => {
    refreshUnread()
    setTimer(currentPollMs())

    const onUpdate = () => refreshUnread()

    function onVisibility() {
      // Eco mode: slow down in background; refresh immediately when visible
      if (document.visibilityState === 'visible') refreshUnread()
      setTimer(currentPollMs())
    }

    window.addEventListener('notifications:updated', onUpdate)
    window.addEventListener('atom:notifications:changed', onUpdate as any)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onVisibility)

    return () => {
      window.removeEventListener('notifications:updated', onUpdate)
      window.removeEventListener('atom:notifications:changed', onUpdate as any)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
      if (timerRef.current) window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNotifications])

  useEffect(() => {
    if (open) refreshUnread()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const filteredAll = useMemo(() => {
    const qq = q.trim().toLowerCase()
    if (!qq) return menuItems
    return menuItems.filter((it) => (it.label + ' ' + it.href).toLowerCase().includes(qq))
  }, [menuItems, q])

  const list = showAll ? filteredAll : quickItems

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => {
          setOpen((v) => !v)
          if (open) {
            setShowAll(false)
            setQ('')
          }
        }}
        className="relative rounded-full bg-black text-white dark:bg-white dark:text-black px-4 py-1.5 text-sm font-semibold shadow-soft hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-black/60 dark:focus:ring-white/60"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menu"
      >
        <span className="inline-flex items-center gap-2">
          Menu {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {/* Overlay 30% covering the page (click to close) */}
      {open && <div className="fixed inset-0 bg-black/30 z-40" aria-hidden onClick={() => setOpen(false)} />}

      {/* Menu panel (above overlay) */}
      {open && (
        <div
          ref={panelRef}
          className="absolute z-50 mt-3 w-72 rounded-2xl border border-black/10 bg-white dark:bg-black shadow-xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
            <div className="text-sm font-semibold">{showAll ? 'All tools' : 'Quick menu'}</div>
            <button
              type="button"
              onClick={() => {
                setShowAll((v) => !v)
                setQ('')
              }}
              className="text-xs font-semibold rounded-full border px-2.5 py-1 hover:bg-black/[0.03] dark:hover:bg-white/[0.06]"
            >
              {showAll ? 'Quick' : `All (${menuItems.length})`}
            </button>
          </div>

          {showAll ? (
            <div className="px-3 pb-2">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/50 dark:text-white/50" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search…"
                  className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-black px-9 py-2 text-sm outline-none focus:ring-2 focus:ring-black/50 dark:focus:ring-white/50"
                  autoFocus
                />
              </div>
            </div>
          ) : null}

          <nav className={'py-2 ' + (showAll ? 'max-h-[70vh] overflow-y-auto' : '')}>
            {list.map((it) => {
              const Icon = ICONS[it.icon] ?? Circle
              const isNotifUnread = it.href === '/notifications' && unreadCount > 0

              return (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={() => {
                    setOpen(false)
                    setShowAll(false)
                    setQ('')
                  }}
                  className={
                    'flex items-center justify-between gap-3 px-3 py-2 text-[15px] hover:bg-black/[0.03] dark:hover:bg-white/[0.06] focus:bg-black/[0.04] dark:focus:bg-white/[0.08] outline-none ' +
                    (isNotifUnread ? 'text-red-700 font-semibold' : '')
                  }
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={
                        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-black/10 dark:border-white/10 ' +
                        (isNotifUnread ? 'border-red-200 bg-red-50 dark:bg-white/10' : '')
                      }
                    >
                      <Icon size={18} strokeWidth={2.2} className={isNotifUnread ? 'text-red-700' : 'text-black dark:text-white'} />
                    </span>
                    <span className="truncate">{it.label}</span>
                  </div>

                  {isNotifUnread ? (
                    <span
                      className="inline-flex min-w-[24px] h-6 items-center justify-center rounded-full bg-red-600 px-2 text-xs font-bold text-white"
                      aria-label={`${unreadCount} unread notifications`}
                      title={`${unreadCount} unread notifications`}
                    >
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  ) : null}
                </Link>
              )
            })}

            {/* Footer */}
            <div className="mt-1 border-t border-black/10 dark:border-white/10 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <Link
                  href="/"
                  onClick={() => {
                    setOpen(false)
                    setShowAll(false)
                    setQ('')
                  }}
                  className="text-xs font-semibold underline"
                  title="Open the Home dashboard"
                >
                  Home
                </Link>

                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    setShowAll(false)
                    setQ('')
                  }}
                  className="text-xs font-semibold rounded-full border px-2.5 py-1 hover:bg-black/[0.03] dark:hover:bg-white/[0.06]"
                >
                  Close
                </button>
              </div>
            </div>
          </nav>
        </div>
      )}
    </div>
  )
}
