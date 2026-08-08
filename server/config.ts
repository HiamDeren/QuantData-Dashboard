import { z } from 'zod'

/**
 * `.env` files spell "not set" as an empty value (`QD_API_KEY=`), so an empty
 * string must mean absent — not a value that fails a min-length check.
 */
const optionalStr = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))

const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  /**
   * Deliberately NOT `PORT`: dev harnesses and PaaS runners inject `PORT` for
   * whatever they consider "the app", and in dev that is Vite. Sharing the name
   * makes the API silently race Vite for the same socket.
   */
  API_PORT: z.coerce.number().int().positive().default(8000),

  // --- Quant Data vendor -----------------------------------------------
  /** Absent -> MockQuantDataClient. Never expose this to the browser bundle. */
  QD_API_KEY: optionalStr,
  QD_BASE_URL: z.string().url().default('https://api.quantdata.us/v1'),
  /** Vendor plan limit. The whole poller shares this one bucket. */
  QD_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(240),

  // --- Poll cadence per tier (ms) ---------------------------------------
  TIER_T0_MS: z.coerce.number().int().positive().default(4_000),
  TIER_T1_MS: z.coerce.number().int().positive().default(20_000),
  TIER_T2_MS: z.coerce.number().int().positive().default(90_000),
  TIER_T3_MS: z.coerce.number().int().positive().default(300_000),
  TIER_T4_MS: z.coerce.number().int().positive().default(3_600_000),

  /** Keep polling this long after the last subscriber leaves. */
  SUBSCRIPTION_GRACE_MS: z.coerce.number().int().nonnegative().default(60_000),

  TICKER_ALLOWLIST: z
    .string()
    .default('SPY,SPX,QQQ,NDX,IWM,GLD,AAPL,NVDA,TSLA,MSFT,META,AMD')
    .transform((s) => s.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean)),

  /**
   * Retail-standard assumption: dealers are short calls / long puts.
   * It is an assumption, not an observation — the UI labels which one is active.
   */
  DEALER_SIGN_CONVENTION: z.enum(['dealer-short-calls', 'dealer-long-calls']).default('dealer-short-calls'),

  // --- Single-user auth gate --------------------------------------------
  AUTH_EMAIL: z.string().trim().default('demo@quantam.io'),
  AUTH_NAME: z.string().trim().default('Lưu Uy Danh'),
  /** scrypt hash from `npm run hash-password`. Absent -> AUTH_DEV_PASSWORD. */
  AUTH_PASSWORD_HASH: optionalStr,
  AUTH_DEV_PASSWORD: z.string().trim().default('quantam123'),
  /** Signs the session cookie. Generated per boot in dev; MUST be set in prod. */
  AUTH_SECRET: optionalStr,
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
})

const parsed = Env.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment:\n' + z.prettifyError(parsed.error))
  process.exit(1)
}

export const config = parsed.data
export const isProd = config.NODE_ENV === 'production'
export const usesMockVendor = !config.QD_API_KEY

if (isProd && !config.AUTH_SECRET) {
  console.error('AUTH_SECRET is required in production — every session cookie would be forgeable on restart.')
  process.exit(1)
}
