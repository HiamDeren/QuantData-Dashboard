import { createContext, use, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { api, ApiError } from '@/lib/api'
import type { SessionUser } from '@shared/contracts'

interface AuthContextValue {
  user: SessionUser | null
  initializing: boolean
  signingIn: boolean
  error: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  clearError: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = use(AuthContext)
  if (!ctx) throw new Error('useAuth phải nằm trong <AuthProvider>')
  return ctx
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The cookie is the source of truth — ask the server who we are on boot.
  useEffect(() => {
    let alive = true
    api
      .me()
      .then(({ user: me }) => alive && setUser(me))
      .catch(() => alive && setUser(null))
      .finally(() => alive && setInitializing(false))
    return () => {
      alive = false
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    setSigningIn(true)
    setError(null)
    try {
      const { user: me } = await api.login(email, password)
      setUser(me)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Đăng nhập thất bại. Vui lòng thử lại.')
      throw err
    } finally {
      setSigningIn(false)
    }
  }, [])

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined)
    setUser(null)
    setError(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, initializing, signingIn, error, login, logout, clearError: () => setError(null) }),
    [user, initializing, signingIn, error, login, logout],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
