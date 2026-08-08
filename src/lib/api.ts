import type { SessionUser } from '@shared/contracts'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Session lives in an httpOnly cookie, so there is no token to attach and
 * nothing for XSS to steal. Same-origin in both dev (vite proxy) and prod
 * (fastify serves the SPA), so credentials ride along automatically.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })

  if (res.status === 204) return undefined as T

  const isJson = res.headers.get('content-type')?.includes('application/json')
  const payload = isJson ? await res.json().catch(() => null) : null

  if (!res.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload
        ? String((payload as { message: unknown }).message)
        : `Yêu cầu thất bại (${res.status})`
    throw new ApiError(message, res.status)
  }

  return payload as T
}

export interface Meta {
  tickers: string[]
  signConvention: 'dealer-short-calls' | 'dealer-long-calls'
  vendor: 'mock' | 'live'
  market: { open: boolean; extended: boolean }
}

export const api = {
  login: (email: string, password: string) =>
    request<{ user: SessionUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<{ user: SessionUser }>('/auth/me'),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  meta: () => request<Meta>('/meta'),
}
