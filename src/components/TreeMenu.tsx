'use client'
import * as React from 'react'
import Link from 'next/link'
import { createPortal } from 'react-dom'

export type MenuItem = { label: string; href: string; desc?: string }

export default function TreeMenu({
  items,
  className = '',
  buttonLabel = 'Menu',
  dimOpacity = 0.7,
}: {
  items: MenuItem[]
  className?: string
  buttonLabel?: string
  dimOpacity?: number
}) {
  const [open, setOpen] = React.useState(false)
  const [mounted, setMounted] = React.useState(false)
  const [portalEl, setPortalEl] = React.useState<HTMLElement | null>(null)
  const btnRef = React.useRef<HTMLButtonElement | null>(null)
  const [deskPos, setDeskPos] = React.useState<{ left: number; top: number; width: number } | null>(null)

  React.useEffect(() => {
    setMounted(true)
    let el = document.getElementById('atom-portal-root') as HTMLElement | null
    if (!el) {
      el = document.createElement('div')
      el.id = 'atom-portal-root'
      Object.assign(el.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2000',
        pointerEvents: 'none',
        isolation: 'isolate',
      })
      document.body.appendChild(el)
    }
    setPortalEl(el)
  }, [])

  React.useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const computeDeskPos = React.useCallback(() => {
    const b = btnRef.current
    if (!b) return
    const r = b.getBoundingClientRect()
    setDeskPos({
      left: Math.round(r.left),
      top: Math.round(r.bottom + 8),
      width: Math.min(Math.round(r.width), 384), // <- corrige ici
    })
  }, [])

  React.useEffect(() => {
    if (!open) return
    computeDeskPos()
    const onScroll = () => computeDeskPos()
    const onResize = () => computeDeskPos()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, computeDeskPos])

  const Overlay =
    open && mounted && portalEl
      ? createPortal(
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 0,
              backgroundColor: `rgba(0,0,0,${dimOpacity})`,
              pointerEvents: 'auto',
            }}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />,
          portalEl
        )
      : null

  const DesktopDropdown =
    open && mounted && portalEl && deskPos
      ? createPortal(
          <div
            id="tree-menu-desktop"
            role="menu"
            aria-modal="true"
            className="hidden md:block"
            style={{
              position: 'absolute',
              zIndex: 1,
              left: deskPos.left,                    // nombres -> px automatiques
              top: deskPos.top,
              width: Math.min(deskPos.width, 384),
              maxWidth: 'min(90vw, 384px)',          // CSS valide
              pointerEvents: 'auto',
              backgroundColor: '#FFFFFF',
              color: '#000000',
              border: '1px solid rgba(0,0,0,0.10)',
              borderRadius: '16px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05), 0 6px 20px rgba(0,0,0,0.06)',
              padding: '8px',
              isolation: 'isolate',
              mixBlendMode: 'normal',
              WebkitBackdropFilter: 'none',
              backdropFilter: 'none',
              opacity: 1,
            }}
          >
            <nav className="flex flex-col">
              {items.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={() => setOpen(false)}
                  role="menuitem"
                  className="rounded-lg px-3 py-2 text-sm hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
                >
                  {it.label}
                </Link>
              ))}
            </nav>
          </div>,
          portalEl
        )
      : null

  const MobileSheet =
    open && mounted && portalEl
      ? createPortal(
          <div
            id="tree-menu-mobile"
            role="menu"
            aria-modal="true"
            className="md:hidden overflow-auto"
            style={{
              position: 'absolute',
              zIndex: 1,
              left: 0,
              right: 0,
              top: '3rem',
              height: 'calc(100vh - 3rem)',
              pointerEvents: 'auto',
              backgroundColor: '#FFFFFF',
              color: '#000000',
              borderTopLeftRadius: '12px',
              borderTopRightRadius: '12px',
              border: '1px solid rgba(0,0,0,0.10)',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05), 0 6px 20px rgba(0,0,0,0.06)',
              padding: '12px',
              isolation: 'isolate',
              mixBlendMode: 'normal',
              WebkitBackdropFilter: 'none',
              backdropFilter: 'none',
              opacity: 1,
            }}
          >
            <div className="mx-auto max-w-md">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-base font-semibold tracking-tight">Menu</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-xl border border-black/10 px-2 py-1 text-xs hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-black"
                  aria-label="Fermer le menu"
                >
                  Fermer
                </button>
              </div>
              <nav className="flex flex-col">
                {items.map((it) => (
                  <Link
                    key={it.href}
                    href={it.href}
                    onClick={() => setOpen(false)}
                    role="menuitem"
                    className="rounded-xl px-4 py-3 text-base hover:bg-gray-50 active:bg-gray-100 focus:bg-gray-50 focus:outline-none"
                  >
                    {it.label}
                  </Link>
                ))}
              </nav>
            </div>
          </div>,
          portalEl
        )
      : null

  return (
    <div className={'relative ' + className}>
      <button
        ref={btnRef}
        type="button"
        aria-expanded={open}
        aria-controls="tree-menu-desktop tree-menu-mobile"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center rounded-2xl border border-black/10 bg-black px-3 py-1.5 text-white text-sm font-medium shadow-soft hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-black"
      >
        {buttonLabel} <span className="ml-2 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {Overlay}
      {DesktopDropdown}
      {MobileSheet}
    </div>
  )
}
