'use client'

import { useCallback, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

export type SafeSubmitSuccess<TData = void> = {
  ok: true
  message?: string
  description?: string
  data?: TData
  refresh?: boolean
  resetForm?: boolean
}

export type SafeSubmitFailure = {
  ok: false
  message?: string
  description?: string
}

export type SafeSubmitResult<TData = void> = SafeSubmitSuccess<TData> | SafeSubmitFailure

export type SafeSubmitContext = {
  form?: HTMLFormElement | null
}

type Options<TData = void> = {
  action: (context: SafeSubmitContext) => Promise<SafeSubmitResult<TData>>
  successToast?: boolean
  errorToast?: boolean
  defaultSuccessMessage?: string
  defaultErrorMessage?: string
  onSuccess?: (result: SafeSubmitSuccess<TData>, context: SafeSubmitContext) => void | Promise<void>
  onError?: (result: SafeSubmitFailure, context: SafeSubmitContext) => void | Promise<void>
  onSettled?: (result: SafeSubmitResult<TData>, context: SafeSubmitContext) => void | Promise<void>
}

function toastOptions(description?: string) {
  return description ? { description } : undefined
}

export function useSafeSubmit<TData = void>({
  action,
  successToast = true,
  errorToast = true,
  defaultSuccessMessage = 'Saved',
  defaultErrorMessage = 'Save failed',
  onSuccess,
  onError,
  onSettled,
}: Options<TData>) {
  const router = useRouter()
  const lockRef = useRef(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isRefreshing, startTransition] = useTransition()

  const submit = useCallback(
    async (context: SafeSubmitContext = {}) => {
      if (lockRef.current) return null

      lockRef.current = true
      setIsSaving(true)

      let result: SafeSubmitResult<TData>

      try {
        result = await action(context)

        if (result.ok) {
          await onSuccess?.(result, context)

          if (result.resetForm) {
            context.form?.reset()
          }

          if (successToast) {
            toast.success(result.message || defaultSuccessMessage, toastOptions(result.description))
          }

          if (result.refresh !== false) {
            startTransition(() => {
              router.refresh()
            })
          }
        } else {
          await onError?.(result, context)

          if (errorToast) {
            toast.error(result.message || defaultErrorMessage, toastOptions(result.description))
          }
        }
      } catch (error) {
        const fallbackDescription = error instanceof Error ? error.message : String(error || '')

        result = {
          ok: false,
          message: defaultErrorMessage,
          description: fallbackDescription || undefined,
        }

        await onError?.(result, context)

        if (errorToast) {
          toast.error(result.message, toastOptions(result.description))
        }
      } finally {
        setIsSaving(false)
        lockRef.current = false
      }

      await onSettled?.(result, context)
      return result
    },
    [action, defaultErrorMessage, defaultSuccessMessage, errorToast, onError, onSettled, onSuccess, router, startTransition, successToast],
  )

  return {
    submit,
    isSaving,
    isRefreshing,
    isPending: isSaving || isRefreshing,
  }
}
