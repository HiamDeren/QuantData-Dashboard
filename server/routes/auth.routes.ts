import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { authenticate, COOKIE_NAME, cookieOptions, issueToken, verifyToken } from '../auth.js'

const LoginBody = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
})

/** Rejects unauthenticated requests. Applied to every data route. */
export async function requireAuth(request: { cookies: Record<string, string | undefined> }) {
  const session = verifyToken(request.cookies[COOKIE_NAME])
  if (!session) {
    const err = new Error('Unauthorized') as Error & { statusCode: number }
    err.statusCode = 401
    throw err
  }
  return session
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  // Blunt brute-force brake. Single-user app: one counter is enough.
  let failures = 0
  let lockedUntil = 0

  app.post('/api/auth/login', async (request, reply) => {
    if (Date.now() < lockedUntil) {
      return reply.code(429).send({ message: 'Quá nhiều lần thử. Vui lòng đợi 60 giây.' })
    }

    const parsed = LoginBody.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Thiếu email hoặc mật khẩu.' })

    const session = authenticate(parsed.data.email, parsed.data.password)
    if (!session) {
      if (++failures >= 5) {
        lockedUntil = Date.now() + 60_000
        failures = 0
      }
      return reply.code(401).send({ message: 'Email hoặc mật khẩu không đúng.' })
    }

    failures = 0
    reply.setCookie(COOKIE_NAME, issueToken(), cookieOptions)
    return { user: session }
  })

  app.get('/api/auth/me', async (request, reply) => {
    const session = verifyToken(request.cookies[COOKIE_NAME])
    if (!session) return reply.code(401).send({ message: 'Chưa đăng nhập.' })
    return { user: session }
  })

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: undefined })
    return reply.code(204).send()
  })
}
