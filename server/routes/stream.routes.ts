import type { FastifyPluginAsync } from 'fastify'

import { bus } from '../bus.js'
import { config } from '../config.js'
import type { PollScheduler } from '../poller/scheduler.js'
import { requireAuth } from './auth.routes.js'
import { DATASETS, parseChannel, type Frame } from '../../shared/contracts.js'

const HEARTBEAT_MS = 15_000
const MAX_CHANNELS_PER_CONNECTION = 8

/**
 * SSE, not WebSocket: a dashboard is one-way, and EventSource gives us
 * reconnect for free. Snapshot on subscribe, patches after; the client detects
 * a `seq` gap and re-subscribes.
 */
export const streamRoutes = (scheduler: PollScheduler): FastifyPluginAsync => async (app) => {
  app.get('/api/stream', async (request, reply) => {
    await requireAuth(request as never)

    const raw = (request.query as { channels?: string }).channels ?? ''
    const requested = raw.split(',').map((c) => c.trim()).filter(Boolean)

    if (requested.length === 0 || requested.length > MAX_CHANNELS_PER_CONNECTION) {
      return reply.code(400).send({ message: `channels: 1..${MAX_CHANNELS_PER_CONNECTION} required` })
    }

    // Allowlist: dataset must be known and ticker must be permitted. A
    // user-supplied string never becomes a vendor path.
    const channels: string[] = []
    for (const channel of requested) {
      const parsed = parseChannel(channel)
      if (!parsed || !DATASETS.includes(parsed.dataset)) {
        return reply.code(400).send({ message: `Kênh không hợp lệ: ${channel}` })
      }
      if (!config.TICKER_ALLOWLIST.includes(parsed.ticker.toUpperCase())) {
        return reply.code(403).send({ message: `Ticker ngoài allowlist: ${parsed.ticker}` })
      }
      channels.push(channel)
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // don't let a reverse proxy buffer the stream
    })
    reply.raw.write(': connected\n\n')

    const send = (frame: Frame) => {
      if (reply.raw.writableEnded) return
      reply.raw.write(`data: ${JSON.stringify(frame)}\n\n`)
    }

    const unsubscribers: Array<() => void> = []
    // Only channels this connection actually subscribed to get released on
    // cleanup — releasing one that failed to subscribe under-counts the job.
    const subscribed: string[] = []

    for (const channel of channels) {
      if (!scheduler.subscribe(channel)) {
        send({
          type: 'status',
          channel,
          seq: 0,
          ts: Date.now(),
          staleMs: 0,
          state: 'error',
          message: 'Không đăng ký được kênh.',
        })
        continue
      }

      // Serve last-good immediately so a new tab paints without waiting a tier.
      const existing = bus.snapshotFrame(channel)
      if (existing) send(existing)

      subscribed.push(channel)
      unsubscribers.push(bus.subscribe(channel, send))
    }

    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(': ping\n\n')
    }, HEARTBEAT_MS)

    // 'close' and 'error' can both fire for one disconnect. Without this guard
    // the second call decrements subscriber counts a connection never held,
    // which stops a job that other clients are still watching.
    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      clearInterval(heartbeat)
      for (const off of unsubscribers) off()
      for (const channel of subscribed) scheduler.unsubscribe(channel)
    }

    request.raw.on('close', cleanup)
    request.raw.on('error', cleanup)
  })
}
