'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

export default function AuthHashRedirect() {
  const pathname = usePathname()

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (pathname !== '/') return

    const hash = window.location.hash || ''
    if (!hash) return

    const looksLikeAuthHash =
      hash.includes('access_token=') ||
      hash.includes('refresh_token=') ||
      hash.includes('type=invite') ||
      hash.includes('type=recovery')

    if (!looksLikeAuthHash) return

    window.location.replace(`/auth/complete-invite${hash}`)
  }, [pathname])

  return null
}