import type { DatasetId } from '../../../shared/contracts.js'
import type { FetchArgs, QuantDataClient } from './client.js'

/**
 * Replays a synthetic but structurally faithful session so the entire UI is
 * developable with ZERO API spend (the vendor plan has no free tier — §0 cost
 * discipline). It emits VENDOR-shaped raw JSON, not DTOs, so the same mappers
 * and zod schemas run in dev and in prod.
 *
 * Replace with recorded fixtures on day 1 of the subscription: record a full
 * session, drop the JSON into `fixtures/`, and point `FixtureQuantDataClient`
 * at it. The response shapes below are MODELED, not vendor-verified.
 */

const RTH_OPEN_MIN = 9 * 60 + 30
const RTH_CLOSE_MIN = 16 * 60

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const hashString = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const REFERENCE: Record<string, { price: number; step: number; vol: number }> = {
  SPY: { price: 551.9, step: 1, vol: 0.0085 },
  SPX: { price: 5519, step: 5, vol: 0.0082 },
  QQQ: { price: 482.6, step: 1, vol: 0.011 },
  NDX: { price: 19_740, step: 25, vol: 0.0108 },
  IWM: { price: 221.4, step: 1, vol: 0.013 },
  GLD: { price: 248.7, step: 1, vol: 0.007 },
  AAPL: { price: 208.34, step: 2.5, vol: 0.014 },
  NVDA: { price: 141.62, step: 2.5, vol: 0.026 },
  TSLA: { price: 243.77, step: 5, vol: 0.031 },
  MSFT: { price: 431.08, step: 5, vol: 0.012 },
  META: { price: 546.21, step: 5, vol: 0.017 },
  AMD: { price: 149.05, step: 2.5, vol: 0.024 },
}

const refFor = (ticker: string) =>
  REFERENCE[ticker] ?? { price: 100 + (hashString(ticker) % 400), step: 1, vol: 0.018 }

const SESSION_LENGTH_MIN = RTH_CLOSE_MIN - RTH_OPEN_MIN // 390

/** Wall-clock at process boot — anchors the accelerated dev clock below. */
const BOOT_MS = Date.now()
/** Start the simulated session mid-afternoon so the UI is populated instantly. */
const OFFLINE_SEED_MIN = 240

/**
 * Minutes elapsed in the RTH session, clamped to [0, 390].
 *
 * Outside real market hours the mock runs an ACCELERATED clock — seeded at
 * minute 240 and advancing one session-minute per wall-second — so the whole
 * dashboard is populated and visibly moving at any hour of the day. Without
 * this the mock is empty every evening and the UI is undevelopable. During real
 * RTH it tracks the actual clock so mock and live behave identically.
 */
function sessionMinutes(sessionDate: string, now: number): number {
  const today = new Date(now).toISOString().slice(0, 10)
  if (sessionDate < today) return SESSION_LENGTH_MIN // past session: complete

  const d = new Date(now)
  const etMinutes = d.getUTCHours() * 60 + d.getUTCMinutes() - 4 * 60 // crude ET (EDT)
  const live = etMinutes - RTH_OPEN_MIN

  if (live >= 0 && live <= SESSION_LENGTH_MIN) return live

  const accelerated = OFFLINE_SEED_MIN + Math.floor((now - BOOT_MS) / 1_000)
  return Math.max(0, Math.min(SESSION_LENGTH_MIN, accelerated))
}

function sessionStartMs(sessionDate: string): number {
  return Date.parse(`${sessionDate}T13:30:00.000Z`) // 09:30 ET in EDT
}

interface Bar {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

/** One deterministic session per (ticker, sessionDate); memoized. */
class MockSession {
  private readonly rnd: () => number
  private readonly ref: { price: number; step: number; vol: number }
  private bars: Bar[] = []
  private builtThroughMin = -1

  constructor(
    readonly ticker: string,
    readonly sessionDate: string,
  ) {
    this.rnd = mulberry32(hashString(`${ticker}:${sessionDate}`))
    this.ref = refFor(ticker)
  }

  /** 1-minute bars, extended incrementally as wall-clock time advances. */
  barsThrough(now: number): Bar[] {
    const target = sessionMinutes(this.sessionDate, now)
    if (target <= this.builtThroughMin) return this.bars

    const start = sessionStartMs(this.sessionDate)
    let last = this.bars.at(-1)?.c ?? this.ref.price

    for (let m = this.builtThroughMin + 1; m <= target; m++) {
      // Intraday vol smile: open and close are more active than midday.
      const u = m / 390
      const shape = 1 + 1.4 * Math.exp(-((u / 0.12) ** 2)) + 0.9 * Math.exp(-(((1 - u) / 0.1) ** 2))
      const drift = (this.rnd() - 0.485) * this.ref.vol * shape * 0.3
      const o = last
      const c = o * (1 + drift)
      const wick = Math.abs(drift) * o * (0.6 + this.rnd())
      this.bars.push({
        t: start + m * 60_000,
        o,
        h: Math.max(o, c) + wick,
        l: Math.min(o, c) - wick,
        c,
        v: Math.round(200_000 * shape * (0.6 + this.rnd())),
      })
      last = c
    }

    this.builtThroughMin = target
    return this.bars
  }

  spot(now: number): number {
    return this.barsThrough(now).at(-1)?.c ?? this.ref.price
  }

  /** Wall-clock `now` translated into this session's timeline. */
  clockMs(now: number): number {
    return sessionStartMs(this.sessionDate) + sessionMinutes(this.sessionDate, now) * 60_000
  }

  /**
   * Strike ladder ±8% around CURRENT spot, on the ticker's tick grid. Anchoring
   * to the reference price instead would skew the ladder as spot drifts, which
   * silently biases total call-vs-put exposure and kills the gamma flip.
   */
  strikes(now: number): number[] {
    const { step } = this.ref
    const spot = this.spot(now)
    const lo = Math.floor((spot * 0.92) / step) * step
    const hi = Math.ceil((spot * 1.08) / step) * step
    const out: number[] = []
    for (let k = lo; k <= hi; k += step) out.push(Number(k.toFixed(2)))
    return out
  }
}

const sessions = new Map<string, MockSession>()
const sessionFor = (ticker: string, sessionDate: string) => {
  const key = `${ticker}:${sessionDate}`
  let s = sessions.get(key)
  if (!s) {
    s = new MockSession(ticker, sessionDate)
    sessions.set(key, s)
  }
  return s
}

/** Rough gamma bell around the strike — shape only, not a pricing model. */
const gammaWeight = (strike: number, spot: number, width: number) =>
  Math.exp(-0.5 * ((strike - spot) / width) ** 2)

function exposureByStrike(session: MockSession, now: number) {
  const spot = session.spot(now)
  const rnd = mulberry32(hashString(`${session.ticker}:${session.sessionDate}:exposure`))
  const width = spot * 0.028

  return session.strikes(now).map((strike) => {
    const moneyness = (strike - spot) / spot
    // Calls cluster above spot, puts below — that separation is what creates the
    // walls and puts a single GEX sign change near spot. Put-heavy overall, so
    // net GEX skews negative the way a real SPY/SPX book does.
    //
    // Jitter stays gentle (±15%) and is SHARED between the two legs: independent
    // per-strike randomness flips the GEX sign between adjacent strikes, which
    // looks wrong and spawns dozens of spurious flip crossings.
    const jitter = 0.85 + rnd() * 0.3
    const callOi = Math.round(4_000 * gammaWeight(strike, spot * 1.025, width * 1.4) * jitter + 120)
    const putOi = Math.round(4_400 * gammaWeight(strike, spot * 0.975, width * 1.4) * jitter + 120)
    const g = gammaWeight(strike, spot, width)

    // Dealer-long-calls / short-puts convention: calls add +GEX, puts add -GEX.
    const notional = spot * spot * 0.01 * 100 * g
    const gex = (callOi - putOi) * notional * 1e-6
    const dex = (callOi * (0.5 + moneyness * 4) - putOi * (0.5 - moneyness * 4)) * spot * 100 * 1e-6
    const vex = (callOi + putOi) * g * spot * 0.4 * 1e-3
    const chex = (callOi - putOi) * g * spot * 0.12 * 1e-3

    return {
      strikePrice: strike,
      gammaExposure: Number(gex.toFixed(3)),
      deltaExposure: Number(dex.toFixed(3)),
      vegaExposure: Number(vex.toFixed(3)),
      charmExposure: Number(chex.toFixed(3)),
      callOpenInterest: callOi,
      putOpenInterest: putOi,
    }
  })
}

const EXPIRY_OFFSETS = [0, 1, 2, 7, 30]
const TRADE_TYPES = ['SWEEP', 'BLOCK', 'SPLIT', 'MULTI'] as const
const SIDES = ['AA', 'A', 'M', 'B', 'BB'] as const

function orderFlow(session: MockSession, now: number, size: number) {
  const spot = session.spot(now)
  const strikes = session.strikes(now)
  const rows: unknown[] = []
  // Prints carry SESSION time, not wall time — otherwise the tape and the price
  // chart disagree whenever the accelerated dev clock is running.
  const sessionNow = session.clockMs(now)
  // Seed by 4s bucket so consecutive polls return a stable, advancing tape.
  const bucket = Math.floor(now / 4_000)

  for (let i = 0; i < size; i++) {
    const rnd = mulberry32(hashString(`${session.ticker}:${bucket - i}`))
    const ts = sessionNow - i * (900 + Math.floor(rnd() * 2_600))
    if (ts < sessionStartMs(session.sessionDate)) break

    const isCall = rnd() > 0.47
    const strike = strikes[Math.floor(rnd() * strikes.length)]
    const dte = EXPIRY_OFFSETS[Math.floor(rnd() * EXPIRY_OFFSETS.length)]
    const contracts = Math.round(10 + rnd() ** 3 * 4_000)
    const price = Math.max(0.02, Math.abs(spot - strike) * 0.06 + rnd() * 2.4 + (dte === 0 ? 0.1 : dte * 0.05))

    rows.push({
      tradeId: `${session.ticker}-${ts}-${i}`,
      timestamp: ts,
      ticker: session.ticker,
      contractType: isCall ? 'CALL' : 'PUT',
      strikePrice: strike,
      expirationDate: new Date(sessionStartMs(session.sessionDate) + dte * 86_400_000)
        .toISOString()
        .slice(0, 10),
      daysToExpiration: dte,
      tradeSide: SIDES[Math.floor(rnd() * SIDES.length)],
      tradeType: TRADE_TYPES[Math.floor(rnd() * TRADE_TYPES.length)],
      size: contracts,
      price: Number(price.toFixed(2)),
      premium: Math.round(contracts * price * 100),
      stockPrice: Number(spot.toFixed(2)),
      impliedVolatility: Number((0.12 + rnd() * 0.55).toFixed(4)),
    })
  }

  return rows
}

function netDrift(session: MockSession, now: number) {
  const bars = session.barsThrough(now)
  const rnd = mulberry32(hashString(`${session.ticker}:${session.sessionDate}:drift`))
  const data: Record<string, unknown> = {}

  let call = 0
  let put = 0
  // 5-minute buckets, cumulative — net drift is a running total, not a rate.
  for (let i = 0; i < bars.length; i += 5) {
    const bar = bars[i]
    const ret = i === 0 ? 0 : (bar.c - bars[i - 5].c) / bars[i - 5].c
    call += (0.4 + rnd()) * 900_000 + ret * 90_000_000
    put += (0.4 + rnd()) * 850_000 - ret * 84_000_000
    data[String(bar.t)] = {
      netCallPremium: Math.round(call),
      netPutPremium: Math.round(put),
      stockPrice: Number(bar.c.toFixed(2)),
    }
  }

  return data
}

function stockPrice(session: MockSession, now: number) {
  const data: Record<string, unknown> = {}
  for (const bar of session.barsThrough(now)) {
    data[String(bar.t)] = {
      open: Number(bar.o.toFixed(2)),
      high: Number(bar.h.toFixed(2)),
      low: Number(bar.l.toFixed(2)),
      close: Number(bar.c.toFixed(2)),
      volume: bar.v,
    }
  }
  return data
}

export class MockQuantDataClient implements QuantDataClient {
  readonly kind = 'mock' as const

  async fetch(dataset: DatasetId, args: FetchArgs): Promise<unknown> {
    const ticker = (args.ticker ?? 'SPY').toUpperCase()
    const sessionDate = args.sessionDate ?? new Date().toISOString().slice(0, 10)
    const session = sessionFor(ticker, sessionDate)
    const now = Date.now()

    // Simulate vendor latency so loading and stale states are exercised in dev.
    await new Promise((r) => setTimeout(r, 60 + Math.random() * 140))

    switch (dataset) {
      case 'exposure-by-strike':
        return { data: exposureByStrike(session, now), stockPrice: Number(session.spot(now).toFixed(2)) }
      case 'order-flow':
        return { data: orderFlow(session, now, args.size ?? 60) }
      case 'net-drift':
        return { data: netDrift(session, now) }
      case 'price':
        return { data: stockPrice(session, now) }
    }
  }
}
