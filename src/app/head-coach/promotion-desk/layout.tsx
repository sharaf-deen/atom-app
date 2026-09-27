import type { ReactNode } from 'react'
import PromotionCeremonyLog from '@/components/belt-promotions/PromotionCeremonyLog'

export default function PromotionDeskLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PromotionCeremonyLog />
      {children}
    </>
  )
}
