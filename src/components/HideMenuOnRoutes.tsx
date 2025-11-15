// src/components/HideMenuOnRoutes.tsx
'use client'

import { usePathname } from 'next/navigation'
import * as React from 'react'

type Props = {
  /** Cache si pathname === un des éléments (après normalisation du slash final) */
  routes?: string[]
  /** Cache si pathname commence par un des préfixes donnés (ex: ['/auth']) */
  prefixes?: string[]
  /** Cache si une des RegExp/chaînes matches le pathname */
  patterns?: Array<RegExp | string>
  /** Alias simple: si true, traite `routes` comme des préfixes (déprécié) */
  startsWith?: boolean
  /** Contenu à afficher à la place des enfants quand c’est caché (ex: div de hauteur fixe) */
  placeholder?: React.ReactNode
  children: React.ReactNode
}

function normalize(path: string) {
  if (!path) return '/'
  // retire le trailing slash sauf pour la racine
  return path !== '/' && path.endsWith('/') ? path.slice(0, -1) : path
}

export default function HideMenuOnRoutes({
  routes = [],
  prefixes = [],
  patterns = [],
  startsWith = false,
  placeholder = null,
  children,
}: Props) {
  const raw = usePathname() || '/'
  const pathname = normalize(raw)

  // 1) correspondance exacte (routes)
  const matchExact =
    routes
      .map(normalize)
      .some((r) => r === pathname)

  if (matchExact) return <>{placeholder}</>

  // 2) alias: si startsWith=true, traite routes comme des préfixes
  if (startsWith) {
    const anyStarts = routes
      .map(normalize)
      .some((r) => pathname === r || pathname.startsWith(r + (r === '/' ? '' : '/')))
    if (anyStarts) return <>{placeholder}</>
  }

  // 3) correspondance par préfixes dédiés
  const matchPrefix = prefixes
    .map(normalize)
    .some((p) => pathname === p || pathname.startsWith(p + (p === '/' ? '' : '/')))

  if (matchPrefix) return <>{placeholder}</>

  // 4) patterns (RegExp ou string simple “includes”)
  const matchPattern = patterns.some((pat) =>
    typeof pat === 'string' ? pathname.includes(pat) : pat.test(pathname)
  )

  if (matchPattern) return <>{placeholder}</>

  // sinon, on affiche
  return <>{children}</>
}
