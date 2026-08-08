import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import cookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'

import { config, isProd, usesMockVendor } from './config.js'
import { PollScheduler } from './poller/scheduler.js'
import { authRoutes } from './routes/auth.routes.js'
import { metaRoutes } from './routes/meta.routes.js'
import { streamRoutes } from './routes/stream.routes.js'
import { LiveQuantDataClient, type QuantDataClient } from './vendor/quantdata/client.js'
import { MockQuantDataClient } from './vendor/quantdata/mock.js'

const here = dirname(fileURLToPath(import.meta.url))

const client: QuantDataClient = usesMockVendor
  ? new MockQuantDataClient()
  : new LiveQuantDataClient(config.QD_API_KEY!)

const scheduler = new PollScheduler(client)

const app = Fastify({
  logger: { level: isProd ? 'info' : 'warn' },
  // SSE responses are streamed manually; don't let Fastify time them out.
  connectionTimeout: 0,
})

// Must be set BEFORE registering route plugins — each plugin context captures
// the handler that exists at registration time.
app.setErrorHandler((error, _request, reply) => {
  const status = (error as { statusCode?: number }).statusCode ?? 500
  if (status >= 500) app.log.error(error)
  const message = error instanceof Error ? error.message : 'Yêu cầu không hợp lệ.'
  reply.code(status).send({ message: status >= 500 ? 'Lỗi máy chủ.' : message })
})

await app.register(cookie)
await app.register(authRoutes)
await app.register(metaRoutes(scheduler))
await app.register(streamRoutes(scheduler))

// In dev, Vite serves the client and proxies /api here. In prod this process
// serves the built SPA too, so the whole app is one origin and one deployment.
if (isProd) {
  await app.register(fastifyStatic, { root: join(here, '..', 'dist') })
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ message: 'Not found' })
    return reply.sendFile('index.html') // SPA fallback
  })
}

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`)
  scheduler.shutdown()
  await app.close()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

await app.listen({ port: config.API_PORT, host: '0.0.0.0' })

console.log(
  `[quantam] :${config.API_PORT} · vendor=${usesMockVendor ? 'MOCK (no API key)' : 'LIVE'} · ` +
    `budget=${config.QD_RATE_LIMIT_PER_MIN}/min · convention=${config.DEALER_SIGN_CONVENTION}`,
)
