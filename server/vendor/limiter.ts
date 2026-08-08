import { config } from '../config.js'

export type Priority = 0 | 1 | 2 | 3 | 4

interface Waiter {
  priority: Priority
  seq: number
  resolve: () => void
  reject: (err: Error) => void
}

/**
 * Central token bucket in front of every vendor call — nothing bypasses it.
 * Continuous refill (limit/60000 tokens per ms) rather than a per-minute reset,
 * so a burst at :59 cannot double-spend across the boundary.
 *
 * Single-process by design (v1 is one server). Swapping to a Redis bucket means
 * reimplementing `acquire`/`penalize` against Redis and nothing else.
 */
export class TokenBucketLimiter {
  private tokens: number
  private lastRefill = Date.now()
  private readonly queue: Waiter[] = []
  private seq = 0
  private timer: NodeJS.Timeout | null = null
  /** Set by a 429 — the whole bucket backs off, not just the caller. */
  private penaltyUntil = 0

  constructor(
    private readonly capacity = config.QD_RATE_LIMIT_PER_MIN,
    private readonly refillPerMs = config.QD_RATE_LIMIT_PER_MIN / 60_000,
  ) {
    this.tokens = capacity
  }

  private refill() {
    const now = Date.now()
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.lastRefill) * this.refillPerMs)
    this.lastRefill = now
  }

  /** Resolves when a token is available. Lower priority number drains first. */
  acquire(priority: Priority): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({ priority, seq: this.seq++, resolve, reject })
      // Stable sort: priority, then arrival — T0 never starves behind T3.
      this.queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq)
      this.pump()
    })
  }

  private pump() {
    this.refill()
    const now = Date.now()

    while (this.queue.length > 0 && this.tokens >= 1 && now >= this.penaltyUntil) {
      this.tokens -= 1
      this.queue.shift()!.resolve()
    }

    if (this.queue.length > 0 && !this.timer) {
      const waitForToken = Math.max(0, (1 - this.tokens) / this.refillPerMs)
      const waitForPenalty = Math.max(0, this.penaltyUntil - now)
      this.timer = setTimeout(
        () => {
          this.timer = null
          this.pump()
        },
        Math.max(25, Math.ceil(Math.max(waitForToken, waitForPenalty))),
      )
    }
  }

  /** Called on a 429 — freeze the entire bucket for `ms`. */
  penalize(ms: number) {
    this.penaltyUntil = Math.max(this.penaltyUntil, Date.now() + ms)
  }

  stats() {
    this.refill()
    return {
      capacity: this.capacity,
      available: Math.floor(this.tokens),
      queued: this.queue.length,
      utilizationPct: Math.round((1 - this.tokens / this.capacity) * 100),
      penalizedForMs: Math.max(0, this.penaltyUntil - Date.now()),
    }
  }
}

export const quantDataLimiter = new TokenBucketLimiter()
