import { config } from '../../config.js'
import { quantDataLimiter, type Priority } from '../limiter.js'
import { buildRequest, TOOLS, toolPath, type VendorRequest } from './endpoints.js'
import type { DatasetId } from '../../../shared/contracts.js'

export class VendorError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'VendorError'
  }
}

export interface FetchArgs extends VendorRequest {
  ticker?: string
  priority: Priority
}

export interface QuantDataClient {
  readonly kind: 'live' | 'mock'
  fetch(dataset: DatasetId, args: FetchArgs): Promise<unknown>
}

const MAX_ATTEMPTS = 4
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Exponential backoff with full jitter, capped at 30s. */
const backoffMs = (attempt: number) => Math.random() * Math.min(30_000, 500 * 2 ** attempt)

export class LiveQuantDataClient implements QuantDataClient {
  readonly kind = 'live' as const

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = config.QD_BASE_URL,
  ) {}

  async fetch(dataset: DatasetId, { priority, ticker, ...rest }: FetchArgs): Promise<unknown> {
    const spec = TOOLS[dataset]
    if (!spec) throw new VendorError(`Unknown dataset ${dataset}`, 400, false)

    const url = `${this.baseUrl}${toolPath(spec)}`
    const body = JSON.stringify(buildRequest({ ticker, ...rest }))

    let lastError: VendorError | null = null

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Every single vendor call passes the shared bucket — no exceptions.
      await quantDataLimiter.acquire(priority)

      try {
        return await this.once(url, body)
      } catch (err) {
        lastError = err instanceof VendorError ? err : new VendorError(String(err), 0, true)
        if (!lastError.retryable) throw lastError

        if (lastError.status === 429) {
          // Back off the whole bucket, not just this caller.
          quantDataLimiter.penalize(Math.min(30_000, 2_000 * 2 ** attempt))
        }
        if (attempt < MAX_ATTEMPTS - 1) await sleep(backoffMs(attempt))
      }
    }

    throw lastError ?? new VendorError('Vendor request failed', 0, true)
  }

  private async once(url: string, body: string): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)

    try {
      const res = await fetch(url, {
        method: 'POST', // every Quant Data endpoint is POST + JSON body
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body,
        signal: controller.signal,
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new VendorError(
          `Quant Data ${res.status}: ${text.slice(0, 200)}`,
          res.status,
          res.status === 429 || res.status >= 500,
        )
      }

      return await res.json()
    } catch (err) {
      if (err instanceof VendorError) throw err
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new VendorError('Quant Data request timed out', 408, true)
      }
      throw new VendorError(`Quant Data transport error: ${String(err)}`, 0, true)
    } finally {
      clearTimeout(timer)
    }
  }
}
