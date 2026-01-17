// src/components/AccessDeniedPage.tsx
import Forbidden from '@/components/Forbidden'

type Action = { href: string; label: string }

export default function AccessDeniedPage({
  title,
  subtitle = 'Access restricted.',
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
    <Forbidden
      pageTitle={title}
      subtitle={subtitle}
      signedInAs={signedInAs}
      message={message}
      allowed={allowed}
      nextPath={nextPath}
      actions={actions}
      showBackHome={showBackHome}
      showProfile={showProfile}
    />
  )
}
