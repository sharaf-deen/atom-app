import type { Metadata } from 'next'
import RegistrationVerificationForm from '@/components/public-registration/RegistrationVerificationForm'

export const metadata: Metadata = {
  title: 'Verify registration email | ATOM',
  robots: { index: false, follow: false },
}

export default function RegistrationVerificationPage() {
  return <><meta name="referrer" content="no-referrer" /><RegistrationVerificationForm /></>
}
