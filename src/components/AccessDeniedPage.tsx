import PageHeader from '@/components/layout/PageHeader'
import Section from '@/components/layout/Section'
import AccessDeniedCard from '@/components/AccessDeniedCard'

type Action = { href: string; label: string }

export default function AccessDeniedPage({
  title,
  subtitle = 'Forbidden.',
  signedInAs,
  message,
  allowed,
  nextPath,
  actions = [],
  showBackHome = true,
  showProfile = false,
}: {
  title: string
  subtitle?: string
  signedInAs?: string | null
  message: string
  allowed?: string
  nextPath: string
  actions?: Action[]
  showBackHome?: boolean
  showProfile?: boolean
}) {
  return (
    <main>
      <PageHeader title={title} subtitle={subtitle} />
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
