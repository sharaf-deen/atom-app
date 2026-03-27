import { NextResponse } from 'next/server'

export type ApiRuntimeMeta = {
  route: string
  requestId: string
  startedAt: number
}

export function startApiRuntime(route: string): ApiRuntimeMeta {
  const requestId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `req_${Math.random().toString(36).slice(2, 10)}`

  return {
    route,
    requestId,
    startedAt: Date.now(),
  }
}

export function safeErrorMessage(error: unknown) {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  try {
    return JSON.stringify(error)
  } catch {
    return 'Unknown error'
  }
}

export function logApiError(meta: ApiRuntimeMeta, stage: string, error: unknown, extra?: Record<string, unknown>) {
  console.error(`[api:${meta.route}]`, {
    request_id: meta.requestId,
    stage,
    error: safeErrorMessage(error),
    ...(extra ?? {}),
  })
}

export function logApiWarn(meta: ApiRuntimeMeta, stage: string, extra?: Record<string, unknown>) {
  console.warn(`[api:${meta.route}]`, {
    request_id: meta.requestId,
    stage,
    ...(extra ?? {}),
  })
}

export function applyApiRuntimeHeaders(
  meta: ApiRuntimeMeta,
  res: NextResponse,
  cacheControl = 'no-store, no-cache, must-revalidate, proxy-revalidate',
) {
  res.headers.set('Cache-Control', cacheControl)
  res.headers.set('x-request-id', meta.requestId)
  res.headers.set('x-runtime-ms', String(Math.max(0, Date.now() - meta.startedAt)))
  return res
}

export function jsonWithApiRuntime<T extends Record<string, unknown>>(
  meta: ApiRuntimeMeta,
  status: number,
  body: T,
  cacheControl?: string,
) {
  return applyApiRuntimeHeaders(
    meta,
    NextResponse.json({ ...body, request_id: meta.requestId }, { status }),
    cacheControl,
  )
}
