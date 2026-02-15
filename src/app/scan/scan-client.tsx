'use client'

import KioskScanner from '@/components/KioskScanner'

/**
 * Legacy component kept for compatibility with older routes.
 * The app now uses a single scanner implementation: KioskScanner
 * (based on @yudiel/react-qr-scanner).
 */
export default function ScanClient() {
  return (
    <main className="max-w-3xl mx-auto p-6">
      <KioskScanner size="sm" ratio="1:1" />
    </main>
  )
}
