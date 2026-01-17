// src/components/Forbidden.tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedCard from '@/components/AccessDeniedCard'

type Action = { href: string; label: string }

export default function Forbidden({
  pageTitle,
  subtitle = 'Access restricted.',
  signedInAs,
  message = "You don’t have permission to view this page.",
  allowed,
  nextPath,
  actions = [],
  showBackHome = true,
  showProfile = false,
}: {
  pageTitle: string
  subtitle?: string
  signedInAs?: string | null
  message?: string
  allowed?: string
  nextPath: string
  actions?: Action[]
  showBackHome?: boolean
  showProfile?: boolean
}) {
  return (
    <main>
      <PageHeader title={pageTitle} subtitle={subtitle} />
      <Section className="max-w-2xl">
        <AccessDeniedCard
          signedInAs={signedInAs}
          title="Forbidden"
          message={message}
          allowed={allowed}
          nextPath={nextPath}
          actions={actions}
          showBackHome={showBackHome}
          showProfile={showProfile}
        />
      </Section>
    </main>
  )
}
