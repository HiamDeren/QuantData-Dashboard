import type { FastifyPluginAsync } from 'fastify'

import { config, usesMockVendor } from '../config.js'
import type { PollScheduler } from '../poller/scheduler.js'
import { marketWindow } from '../poller/tiers.js'
import { requireAuth } from './auth.routes.js'

export const metaRoutes = (scheduler: PollScheduler): FastifyPluginAsync => async (app) => {
  app.get('/api/health', async () => ({
    ok: true,
    vendor: usesMockVendor ? 'mock' : 'live',
    market: marketWindow(),
    ts: Date.now(),
  }))

  /** Config the client needs but must not hardcode. No secrets here, ever. */
  app.get('/api/meta', async (request) => {
    await requireAuth(request as never)
    return {
      tickers: config.TICKER_ALLOWLIST,
      signConvention: config.DEALER_SIGN_CONVENTION,
      vendor: usesMockVendor ? 'mock' : 'live',
      market: marketWindow(),
    }
  })

  /** Rate-budget utilization + per-job counters — alert above 80%. */
  app.get('/api/stats', async (request) => {
    await requireAuth(request as never)
    return scheduler.stats()
  })
}
