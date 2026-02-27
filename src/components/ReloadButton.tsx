// src/components/ReloadButton.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
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
      loading={isPending}
      loadingText="Reloading"
      onClick={() => {
        startTransition(() => {
          // router.refresh() = re-fetch RSC data (best for dashboards)
          router.refresh()

          // Also notify client components that use client-side fetch so they can refetch.
          try {
            window.dispatchEvent(new Event('atom:reload'))
          } catch {}
        })
      }}
      aria-label={label}
      title={label}
    >
      {label}
    </Button>
  )
}
