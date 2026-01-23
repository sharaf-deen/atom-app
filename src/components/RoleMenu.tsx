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
  Circle,
} from 'lucide-react'
import type { IconKey, MenuItem } from './AppNav'

const ICONS: Record<IconKey, React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>> = {
  dashboard: LayoutDashboard,
  bell: Bell,
  gift: Gift,
  id: IdCard,
  scan: ScanLine,
  users: Users,
  'user-cog': UserCog,
  bag: ShoppingBag,
  wallet: Wallet,
}

export default function RoleMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const hasNotifications = useMemo(() => items.some((it) => it.href === '/notifications'), [items])

  const [unreadCount, setUnreadCount] = useState<number>(0)

  async function refreshUnread() {
    if (!hasNotifications) {
      setUnreadCount(0)
      return
    }
    try {
      const r = await fetch('/api/notifications/unread-count', { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) return
      setUnreadCount(Number(j.count || 0))
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!open) return
      const t = e.target as Node
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
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

    const onUpdate = () => refreshUnread()
    window.addEventListener('notifications:updated', onUpdate)

    // Keep it fresh even if user stays in the app
    const t = window.setInterval(() => refreshUnread(), 60_000)

    return () => {
      window.removeEventListener('notifications:updated', onUpdate)
      window.clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNotifications])

  useEffect(() => {
    if (open) refreshUnread()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const showBtnBadge = hasNotifications && unreadCount > 0

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-full bg-black text-white dark:bg-white dark:text-black px-4 py-1.5 text-sm font-semibold shadow-soft hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-black/60 dark:focus:ring-white/60"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={
          showBtnBadge
            ? `Menu (${unreadCount > 99 ? '99+' : unreadCount} unread notifications)`
            : 'Menu'
        }
      >
        <span className="inline-flex items-center gap-2">
          Menu {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>

        {/* ✅ Badge directly on the Menu button */}
        {showBtnBadge ? (
          <span
            className="absolute -right-1 -top-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white shadow"
            aria-hidden
            title={`${unreadCount} unread notifications`}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      {/* Overlay 30% covering the page (click to close) */}
      {open && (
        <div className="fixed inset-0 bg-black/30 z-40" aria-hidden onClick={() => setOpen(false)} />
      )}

      {/* Menu panel (above overlay) */}
      {open && (
        <div
          ref={panelRef}
          className="absolute z-50 mt-3 w-60 sm:w-72 rounded-2xl border border-black/10 bg-white dark:bg-black shadow-xl"
        >
          <nav className="py-2">
            {items.map((it) => {
              const Icon = ICONS[it.icon] ?? Circle
              const isNotifUnread = it.href === '/notifications' && unreadCount > 0

              return (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={() => setOpen(false)}
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
                      <Icon
                        size={18}
                        strokeWidth={2.2}
                        className={isNotifUnread ? 'text-red-700' : 'text-black dark:text-white'}
                      />
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
          </nav>
        </div>
      )}
    </div>
  )
}
