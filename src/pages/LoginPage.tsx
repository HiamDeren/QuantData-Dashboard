import { useEffect, useId, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import Logo from '@/components/layout/Logo'
import { IconAlert, IconEye, IconEyeOff } from '@/components/layout/icons'
import { Spinner } from '@/components/ui/RouteFallback'

interface LocationState {
  from?: { pathname: string; search?: string }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function LoginPage() {
  const { login, signingIn, error, clearError } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const emailId = useId()
  const passwordId = useId()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [touched, setTouched] = useState(false)
  const [devHint, setDevHint] = useState(false)

  // The gate is private-deployment protection, not user management — surface the
  // dev credentials only while the server is still running on mock data.
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((h: { vendor?: string }) => setDevHint(h.vendor === 'mock'))
      .catch(() => undefined)
  }, [])

  const emailInvalid = touched && !EMAIL_RE.test(email.trim())
  const passwordInvalid = touched && password.length < 6

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setTouched(true)
    if (!EMAIL_RE.test(email.trim()) || password.length < 6) return

    try {
      await login(email, password)
      const from = (location.state as LocationState | null)?.from
      navigate(from ? `${from.pathname}${from.search ?? ''}` : '/dashboard', { replace: true })
    } catch {
      /* message already lives in auth context */
    }
  }

  return (
    <div className="bg-plane relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(56rem 28rem at 50% -8%, rgba(56,189,248,0.14), transparent 62%),' +
            'linear-gradient(var(--color-grid) 1px, transparent 1px),' +
            'linear-gradient(90deg, var(--color-grid) 1px, transparent 1px)',
          backgroundSize: '100% 100%, 44px 44px, 44px 44px',
          maskImage: 'radial-gradient(68% 58% at 50% 40%, #000 28%, transparent 100%)',
        }}
      />

      <div className="relative w-full max-w-[380px]">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo size={38} />
          <div>
            <h1 className="text-lg font-bold tracking-tight">GEX Flow Terminal</h1>
            <p className="text-ink-2 mt-1 text-xs">Truy cập nội bộ. Mọi phiên đều được ghi nhật ký.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} noValidate className="panel p-5 shadow-2xl shadow-black/50">
          {error && (
            <div
              role="alert"
              className="border-put/40 bg-put/10 text-put mb-4 flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs"
            >
              <IconAlert className="mt-px size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-3.5">
            <div>
              <label htmlFor={emailId} className="mb-1.5 block text-[11px] font-medium">
                Email
              </label>
              <input
                id={emailId}
                type="email"
                inputMode="email"
                autoComplete="username"
                autoFocus
                required
                className={`field w-full ${emailInvalid ? 'border-put/60' : ''}`}
                placeholder="ban@congty.com"
                value={email}
                aria-invalid={emailInvalid}
                aria-describedby={emailInvalid ? `${emailId}-err` : undefined}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (error) clearError()
                }}
              />
              {emailInvalid && (
                <p id={`${emailId}-err`} className="text-put mt-1 text-[11px]">
                  Email không hợp lệ.
                </p>
              )}
            </div>

            <div>
              <label htmlFor={passwordId} className="mb-1.5 block text-[11px] font-medium">
                Mật khẩu
              </label>
              <div className="relative">
                <input
                  id={passwordId}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  minLength={6}
                  className={`field w-full pr-10 ${passwordInvalid ? 'border-put/60' : ''}`}
                  placeholder="••••••••"
                  value={password}
                  aria-invalid={passwordInvalid}
                  aria-describedby={passwordInvalid ? `${passwordId}-err` : undefined}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    if (error) clearError()
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="text-ink-3 hover:text-ink absolute inset-y-0 right-0 grid w-10 place-items-center transition-colors"
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <IconEyeOff className="size-4" /> : <IconEye className="size-4" />}
                </button>
              </div>
              {passwordInvalid && (
                <p id={`${passwordId}-err`} className="text-put mt-1 text-[11px]">
                  Mật khẩu tối thiểu 6 ký tự.
                </p>
              )}
            </div>
          </div>

          <button type="submit" disabled={signingIn} className="btn-primary mt-5 w-full">
            {signingIn && <Spinner />}
            {signingIn ? 'Đang xác thực…' : 'Đăng nhập'}
          </button>

          {devHint && (
            <p className="border-line text-ink-3 mt-4 border-t pt-3 text-center text-[10px]">
              Chế độ mock — <span className="num text-ink-2">demo@quantam.io</span> /{' '}
              <span className="num text-ink-2">quantam123</span>
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
