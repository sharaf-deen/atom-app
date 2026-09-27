import type { ReactNode } from 'react'
import Link from 'next/link'
import PromotionCeremonyLog from '@/components/belt-promotions/PromotionCeremonyLog'

export default function PromotionDeskLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="mx-auto flex w-full max-w-5xl flex-wrap gap-2 px-4 pt-4 sm:px-6">
        <Link
          href="/head-coach/promotion-readiness"
          className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
        >
          Promotion Readiness
        </Link>
        <Link
          href="/head-coach/belt-promotions"
          className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-semibold hover:bg-black/[0.03]"
        >
          Promotion Events
        </Link>
      </div>
      <PromotionCeremonyLog />
      {children}
    </>
  )
}
