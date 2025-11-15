import * as React from 'react'
import Container from './Container'
export default function Section({ children, className = '' }: React.PropsWithChildren<{ className?: string }>) {
  return <Container className={`py-6 ${className}`}>{children}</Container>
}
