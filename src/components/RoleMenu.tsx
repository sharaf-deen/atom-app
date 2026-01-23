'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { ChevronUp, ChevronDown, LayoutDashboard, Bell, Gift, IdCard, ScanLine, Users, UserCog, ShoppingBag, Wallet, Circle } from 'lucide-react'
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
  const [unreadCount, setUnreadCount] = useState<number>(0)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const hasNotifications = items.some((it) => it.href === '/notifications')

  async function fetchUnreadCount() {
    if (!hasNotifications) return
    try {
      const r = await fetch('/api/notifications/unread-count', { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) return
      setUnreadCount(Number(j?.count || 0))
    } catch {
      // ignore
    }
  }

  // Load once on mount, then refresh each time the menu is opened
  useEffect(() => {
    fetchUnreadCount()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNotifications])

  useEffect(() => {
    if (open) fetchUnreadCount()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

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

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className="rounded-full bg-black text-white dark:bg-white dark:text-black px-4 py-1.5 text-sm font-semibold shadow-soft hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-black/60 dark:focus:ring-white/60"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-2">
          Menu {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {/* Overlay 30% covering the page (click to close) */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-40"
          aria-hidden
          onClick={() => setOpen(false)}
        />
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
              const isNotif = it.href === '/notifications'
              const showUnread = isNotif && unreadCount > 0
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 px-3 py-2 text-[15px] hover:bg-black/[0.03] dark:hover:bg-white/[0.06] focus:bg-black/[0.04] dark:focus:bg-white/[0.08] outline-none"
                >
                  <span
                    className={
                      'relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ' +
                      (showUnread ? 'border-red-500' : 'border-black/10 dark:border-white/10')
                    }
                  >
                    <Icon
                      size={18}
                      strokeWidth={2.2}
                      className={showUnread ? 'text-red-600' : 'text-black dark:text-white'}
                    />
                    {showUnread ? (
                      <span
                        aria-hidden
                        className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-600"
                      />
                    ) : null}
                  </span>
                  <span className={'truncate ' + (showUnread ? 'text-red-600 font-semibold' : '')}>
                    {it.label}
                  </span>
                </Link>
              )
            })}
          </nav>
        </div>
      )}
    </div>
  )
}
