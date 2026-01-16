// src/components/ReloadButton.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { RotateCw } from 'lucide-react'
import Button from '@/components/ui/Button'

export default function ReloadButton({
  label = 'Reload',
  className = '',
}: {
  label?: string
  className?: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={'gap-2 ' + className}
      disabled={isPending}
      onClick={() => {
        startTransition(() => {
          // router.refresh() = re-fetch RSC data (best for dashboards)
          router.refresh()
        })
      }}
      aria-label={label}
      title={label}
    >
      <RotateCw className={'h-4 w-4 ' + (isPending ? 'animate-spin' : '')} />
      {label}
    </Button>
  )
}
