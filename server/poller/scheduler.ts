import { bus } from '../bus.js'
import { config } from '../config.js'
import { MAPPERS } from '../domain/mappers.js'
import { quantDataLimiter } from '../vendor/limiter.js'
import type { QuantDataClient } from '../vendor/quantdata/client.js'
import { channelKey, parseChannel, type DatasetId, type TapeSnapshot } from '../../shared/contracts.js'
import { effectiveInterval, jitter, TIERS } from './tiers.js'

/** Bounded ring buffer — the tape must not grow without limit on a busy day. */
const TAPE_LIMIT = 2_000

interface Job {
  channel: string
  dataset: DatasetId
  ticker: string
  sessionDate: string
  subscribers: number
  timer: NodeJS.Timeout | null
  /** Set when the last subscriber leaves; poll continues until it fires. */
  graceTimer: NodeJS.Timeout | null
  consecutiveFailures: number
  /** Circuit breaker — skip polls until this time, then send one probe. */
  openUntil: number
  lastPrintTs: number
  polls: number
  errors: number
}

/**
 * Exactly one process polls the vendor; every browser subscribes to us. A
 * `{dataset, ticker}` pair is polled ONLY while at least one client is watching
 * it (plus a grace window) — this is what makes more than one ticker viable
 * inside 240 req/min.
 */
export class PollScheduler {
  private readonly jobs = new Map<string, Job>()

  constructor(private readonly client: QuantDataClient) {}

  subscribe(channel: string): boolean {
    const parsed = parseChannel(channel)
    if (!parsed) return false
    if (!config.TICKER_ALLOWLIST.includes(parsed.ticker.toUpperCase())) return false

    let job = this.jobs.get(channel)
    if (!job) {
      job = {
        channel,
        dataset: parsed.dataset,
        ticker: parsed.ticker.toUpperCase(),
        sessionDate: parsed.sessionDate,
        subscribers: 0,
        timer: null,
        graceTimer: null,
        consecutiveFailures: 0,
        openUntil: 0,
        lastPrintTs: 0,
        polls: 0,
        errors: 0,
      }
      this.jobs.set(channel, job)
    }

    job.subscribers += 1
    if (job.graceTimer) {
      clearTimeout(job.graceTimer)
      job.graceTimer = null
    }
    if (!job.timer) void this.runNow(job)

    return true
  }

  unsubscribe(channel: string): void {
    const job = this.jobs.get(channel)
    if (!job) return

    job.subscribers = Math.max(0, job.subscribers - 1)
    if (job.subscribers > 0 || job.graceTimer) return

    // Keep polling briefly — a page navigation should not cost a cold restart.
    job.graceTimer = setTimeout(() => this.stop(job), config.SUBSCRIPTION_GRACE_MS)
  }

  private stop(job: Job) {
    if (job.timer) clearTimeout(job.timer)
    if (job.graceTimer) clearTimeout(job.graceTimer)
    this.jobs.delete(job.channel)
  }

  private schedule(job: Job) {
    if (job.timer) clearTimeout(job.timer)
    const base = effectiveInterval(job.dataset)
    // Failures stretch the interval so a dead endpoint stops burning budget.
    const backoff = Math.min(8, 2 ** job.consecutiveFailures)
    job.timer = setTimeout(() => void this.runNow(job), jitter(base * backoff))
  }

  private async runNow(job: Job) {
    if (!this.jobs.has(job.channel)) return

    // Circuit open: skip the call entirely, but keep the loop alive for the probe.
    if (Date.now() < job.openUntil) {
      this.schedule(job)
      return
    }

    try {
      const raw = await this.client.fetch(job.dataset, {
        priority: TIERS[job.dataset].priority,
        ticker: job.ticker,
        sessionDate: job.sessionDate,
        ...(job.dataset === 'order-flow' ? { size: 60 } : {}),
      })

      job.polls += 1
      job.consecutiveFailures = 0
      job.openUntil = 0

      const ctx = { ticker: job.ticker, sessionDate: job.sessionDate }
      const dto = MAPPERS[job.dataset](raw as never, ctx)

      if (job.dataset === 'order-flow') this.publishTape(job, dto as TapeSnapshot)
      else bus.publishSnapshot(job.channel, dto)
    } catch (err) {
      job.errors += 1
      job.consecutiveFailures += 1
      // Three straight failures -> open the breaker for 60s, half-open after.
      if (job.consecutiveFailures >= 3) job.openUntil = Date.now() + 60_000
      bus.publishError(job.channel, err instanceof Error ? err.message : String(err))
    } finally {
      this.schedule(job)
    }
  }

  /**
   * The tape is append-only: publish just the prints newer than the last one
   * seen, and fold them into the stored snapshot so a late subscriber still
   * receives a full buffer.
   */
  private publishTape(job: Job, snapshot: TapeSnapshot) {
    if (!bus.has(job.channel)) {
      bus.publishSnapshot(job.channel, {
        ...snapshot,
        prints: snapshot.prints.slice(0, TAPE_LIMIT),
      })
      job.lastPrintTs = snapshot.prints[0]?.ts ?? 0
      return
    }

    const fresh = snapshot.prints.filter((p) => p.ts > job.lastPrintTs)
    if (fresh.length === 0) return

    job.lastPrintTs = fresh[0].ts
    bus.publishPatch(job.channel, { prints: fresh }, (prev) => {
      const current = prev as TapeSnapshot
      return {
        ...current,
        prints: [...fresh, ...current.prints].slice(0, TAPE_LIMIT),
      }
    })
  }

  stats() {
    return {
      limiter: quantDataLimiter.stats(),
      vendor: this.client.kind,
      jobs: [...this.jobs.values()].map((j) => ({
        channel: j.channel,
        tier: TIERS[j.dataset].label,
        intervalMs: effectiveInterval(j.dataset),
        subscribers: j.subscribers,
        polls: j.polls,
        errors: j.errors,
        breakerOpen: Date.now() < j.openUntil,
      })),
    }
  }

  shutdown() {
    for (const job of [...this.jobs.values()]) this.stop(job)
  }
}

export { channelKey }
