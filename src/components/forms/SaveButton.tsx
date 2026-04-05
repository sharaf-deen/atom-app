'use client'

import * as React from 'react'
import { useFormStatus } from 'react-dom'

import Button from '@/components/ui/Button'

type ButtonProps = React.ComponentProps<typeof Button>

type SaveButtonProps = Omit<ButtonProps, 'loading' | 'loadingText'> & {
  idleLabel?: React.ReactNode
  pendingLabel?: string
  loading?: boolean
}

export function SaveButton({
  idleLabel,
  pendingLabel = 'Saving...',
  loading,
  children,
  type = 'submit',
  disabled,
  ...props
}: SaveButtonProps) {
  const { pending } = useFormStatus()
  const isLoading = loading ?? pending
  const idleContent = idleLabel ?? children ?? 'Save'

  return (
    <Button
      {...props}
      type={type}
      disabled={disabled || isLoading}
      loading={isLoading}
      loadingText={pendingLabel}
      aria-disabled={disabled || isLoading}
      aria-busy={isLoading ? true : undefined}
    >
      {idleContent}
    </Button>
  )
}

export default SaveButton
