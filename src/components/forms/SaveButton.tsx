'use client'

import * as React from 'react'
import { useFormStatus } from 'react-dom'

import Button from '@/components/ui/Button'

type ButtonProps = React.ComponentProps<typeof Button>

type Props = Omit<ButtonProps, 'children' | 'loading' | 'loadingText'> & {
  idleLabel?: string
  pendingLabel?: string
  loading?: boolean
}

export default function SaveButton({
  idleLabel = 'Save',
  pendingLabel = 'Saving...',
  loading,
  type = 'submit',
  disabled,
  ...props
}: Props) {
  const { pending } = useFormStatus()
  const isLoading = loading ?? pending

  return (
    <Button
      {...props}
      type={type}
      disabled={disabled || isLoading}
      loading={isLoading}
      loadingText={pendingLabel}
      aria-disabled={disabled || isLoading}
    >
      {idleLabel}
    </Button>
  )
}
