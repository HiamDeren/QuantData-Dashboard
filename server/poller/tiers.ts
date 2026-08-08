import { config, usesMockVendor } from '../config.js'
import type { Priority } from '../vendor/limiter.js'
import type { DatasetId } from '../../shared/contracts.js'

export interface TierSpec {
  priority: Priority
  intervalMs: number
  label: string
}

/**
 * Cadence is set by each dataset's true refresh half-life, not by what feels
 * live. Naive 5s-everything is 96 req/min for a SINGLE ticker against a
 * 240/min budget — two tickers and the whole dashboard dies.
 *
 * v1 cost, one ticker:
 *   T0 order-flow  60/4  = 15.0
 *   T1 net-drift   60/20 =  3.0
 *   T1 price       60/20 =  3.0
 *   T2 exposure    60/90 =  0.7
 *                  ------------
 *                  ~21.7 req/min  ->  ~10 concurrent tickers before the cap.
 */
export const TIERS: Record<DatasetId, TierSpec> = {
  'order-flow': { priority: 0, intervalMs: config.TIER_T0_MS, label: 'T0' },
  'net-drift': { priority: 1, intervalMs: config.TIER_T1_MS, label: 'T1' },
  price: { priority: 1, intervalMs: config.TIER_T1_MS, label: 'T1' },
  'exposure-by-strike': { priority: 2, intervalMs: config.TIER_T2_MS, label: 'T2' },
}

/** ±10% so tiers never align into a synchronized burst against the bucket. */
export const jitter = (ms: number) => Math.round(ms * (0.9 + Math.random() * 0.2))

const HOLIDAYS_2026 = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
])

export interface MarketWindow {
  open: boolean
  /** Extended hours (04:00–09:30, 16:00–20:00 ET) — poll, but demoted. */
  extended: boolean
}

/**
 * Crude ET conversion (fixed UTC-4). Good enough to gate polling; swap for a
 * tz-aware library if session boundaries ever need to be exact.
 */
export function marketWindow(now = new Date()): MarketWindow {
  const date = now.toISOString().slice(0, 10)
  const day = now.getUTCDay()
  if (day === 0 || day === 6 || HOLIDAYS_2026.has(date)) return { open: false, extended: false }

  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes() - 4 * 60
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return { open: true, extended: false }
  if (minutes >= 4 * 60 && minutes < 20 * 60) return { open: false, extended: true }
  return { open: false, extended: false }
}

/**
 * Outside RTH everything drops to T4 — nothing on this dashboard changes fast
 * enough after the close to justify spending the budget on it.
 *
 * The gate exists purely to protect the vendor rate budget, so it does not
 * apply to the mock client: mock polls are free, and gating them would make the
 * dashboard undevelopable outside market hours.
 */
export function effectiveInterval(dataset: DatasetId, now = new Date()): number {
  const base = TIERS[dataset].intervalMs
  if (usesMockVendor) return base

  const window = marketWindow(now)
  if (window.open) return base
  if (window.extended) return Math.max(base, config.TIER_T3_MS)
  return config.TIER_T4_MS
}
