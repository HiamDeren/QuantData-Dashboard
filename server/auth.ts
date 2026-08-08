import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

import { config, isProd } from './config.js'
import type { SessionUser } from '../shared/contracts.js'

/**
 * Single-user gate. Its job is keeping a private deployment private, not
 * managing users — so no registration, no roles, no multi-tenancy (§8).
 */

const SECRET = config.AUTH_SECRET ?? randomBytes(32).toString('hex')
if (!config.AUTH_SECRET && !isProd) {
  console.warn('[auth] AUTH_SECRET unset — sessions will not survive a restart (dev only).')
}

export const COOKIE_NAME = 'qam_session'

export const user: SessionUser = {
  email: config.AUTH_EMAIL,
  name: config.AUTH_NAME,
  initials: config.AUTH_NAME.split(/\s+/).slice(-2).map((w) => w[0]?.toUpperCase() ?? '').join(''),
}

/** `salt:hash`, scrypt N=16384. Produced by `npm run hash-password`. */
export function hashPassword(password: string, salt = randomBytes(16).toString('hex')): string {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

function verifyPassword(password: string): boolean {
  if (config.AUTH_PASSWORD_HASH) {
    const [salt, expected] = config.AUTH_PASSWORD_HASH.split(':')
    if (!salt || !expected) return false
    const actual = scryptSync(password, salt, 64)
    const expectedBuf = Buffer.from(expected, 'hex')
    return actual.length === expectedBuf.length && timingSafeEqual(actual, expectedBuf)
  }

  // Dev fallback. Constant-time even here so the code path is identical.
  const a = Buffer.from(password)
  const b = Buffer.from(config.AUTH_DEV_PASSWORD)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function authenticate(email: string, password: string): SessionUser | null {
  const emailOk = email.trim().toLowerCase() === config.AUTH_EMAIL.toLowerCase()
  // Always run the password check so a wrong email is not faster than a wrong password.
  const passwordOk = verifyPassword(password)
  return emailOk && passwordOk ? user : null
}

const sign = (value: string) => createHmac('sha256', SECRET).update(value).digest('base64url')

/** `|` separates the claims — an email contains dots, so `.` cannot be used here. */
const CLAIM_SEP = '|'

export function issueToken(): string {
  const expiresAt = Date.now() + config.SESSION_TTL_HOURS * 3_600_000
  const body = `${config.AUTH_EMAIL}${CLAIM_SEP}${expiresAt}`
  return `${Buffer.from(body).toString('base64url')}.${sign(body)}`
}

export function verifyToken(token: string | undefined): SessionUser | null {
  if (!token) return null

  const [encoded, signature] = token.split('.')
  if (!encoded || !signature) return null

  const body = Buffer.from(encoded, 'base64url').toString()
  const expected = sign(body)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  const [email, expiresAt] = body.split(CLAIM_SEP)
  if (email !== config.AUTH_EMAIL) return null
  if (!Number(expiresAt) || Number(expiresAt) < Date.now()) return null

  return user
}

export const cookieOptions = {
  httpOnly: true, // token unreadable from JS -> XSS cannot exfiltrate the session
  sameSite: 'lax' as const,
  secure: isProd,
  path: '/',
  maxAge: config.SESSION_TTL_HOURS * 3_600,
}
