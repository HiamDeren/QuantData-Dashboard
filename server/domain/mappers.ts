import { config } from '../config.js'
import type {
  ContractType,
  ExposureProfile,
  ExposureStrike,
  NetDrift,
  PriceSeries,
  TapePrint,
  TapeSnapshot,
  TradeSide,
  TradeType,
} from '../../shared/contracts.js'
import { deriveStructure } from './derive.js'
import { field, num, payload, str, toRows } from './normalize.js'

/**
 * One mapper per endpoint: vendor raw -> domain DTO. These are the ONLY files
 * that know vendor field names. Field access goes through `num`/`str` so all
 * four vendor spellings resolve without a mapper caring which one arrived.
 */

interface MapContext {
  ticker: string
  sessionDate: string
}

// -------------------------------------------------------- exposure-by-strike

export function mapExposureByStrike(raw: unknown, ctx: MapContext): ExposureProfile {
  const rows = toRows(payload(raw))

  const strikes: ExposureStrike[] = rows
    .map((row) => ({
      // Bucket-keyed variant puts the strike in the object key.
      strike: num(row, 'strikePrice', 'strike') || Number(row.__key) || 0,
      gex: num(row, 'gammaExposure', 'gex', 'netGammaExposure'),
      dex: num(row, 'deltaExposure', 'dex', 'netDeltaExposure'),
      vex: num(row, 'vegaExposure', 'vex', 'netVegaExposure'),
      chex: num(row, 'charmExposure', 'chex', 'netCharmExposure'),
      callOi: num(row, 'callOpenInterest', 'callOi'),
      putOi: num(row, 'putOpenInterest', 'putOi'),
    }))
    .filter((s) => s.strike > 0)
    .sort((a, b) => a.strike - b.strike)

  const top = (raw ?? {}) as Record<string, unknown>
  const spot = num(top, 'stockPrice', 'spot', 'underlyingPrice')

  const derived = deriveStructure(strikes, spot, config.DEALER_SIGN_CONVENTION)

  return {
    ticker: ctx.ticker,
    sessionDate: ctx.sessionDate,
    spot,
    strikes,
    ...derived,
    signConvention: config.DEALER_SIGN_CONVENTION,
  }
}

// ---------------------------------------------------------------- order-flow

const CONTRACT_TYPES = new Set<ContractType>(['CALL', 'PUT'])
const TRADE_SIDES = new Set<TradeSide>(['A', 'AA', 'B', 'BB', 'M'])
const TRADE_TYPES = new Set<TradeType>(['SWEEP', 'BLOCK', 'SPLIT', 'MULTI'])

export function mapOrderFlow(raw: unknown, ctx: MapContext): TapeSnapshot {
  const rows = toRows(payload(raw))

  const prints: TapePrint[] = rows
    .map((row, i) => {
      const type = str(row, 'contractType', 'optionType').toUpperCase()
      const side = str(row, 'tradeSide', 'side').toUpperCase()
      const tradeType = str(row, 'tradeType', 'type').toUpperCase()
      const ts = num(row, 'timestamp', 'time', 'executedAt') || Number(row.__key) || 0
      const size = num(row, 'size', 'volume', 'quantity')
      const price = num(row, 'price', 'fillPrice')

      return {
        id: str(row, 'tradeId', 'id') || `${ctx.ticker}-${ts}-${i}`,
        ts,
        ticker: str(row, 'ticker', 'symbol') || ctx.ticker,
        contractType: (CONTRACT_TYPES.has(type as ContractType) ? type : 'CALL') as ContractType,
        strike: num(row, 'strikePrice', 'strike'),
        expiration: str(row, 'expirationDate', 'expiration'),
        dte: num(row, 'daysToExpiration', 'dte'),
        side: (TRADE_SIDES.has(side as TradeSide) ? side : 'M') as TradeSide,
        tradeType: (TRADE_TYPES.has(tradeType as TradeType) ? tradeType : 'BLOCK') as TradeType,
        size,
        price,
        // Vendor may or may not ship premium; derive when absent.
        premium: num(row, 'premium', 'notional') || Math.round(size * price * 100),
        spot: num(row, 'stockPrice', 'underlyingPrice'),
        iv: num(row, 'impliedVolatility', 'iv'),
      }
    })
    .filter((p) => p.ts > 0)
    .sort((a, b) => b.ts - a.ts) // newest first — the tape reads top-down

  return { ticker: ctx.ticker, sessionDate: ctx.sessionDate, prints }
}

// ------------------------------------------------------------------ net-drift

export function mapNetDrift(raw: unknown, ctx: MapContext): NetDrift {
  const rows = toRows(payload(raw))

  return {
    ticker: ctx.ticker,
    sessionDate: ctx.sessionDate,
    buckets: rows
      .map((row) => ({
        t: num(row, 'timestamp', 'time') || Number(row.__key) || 0,
        netCallPremium: num(row, 'netCallPremium', 'callPremium'),
        netPutPremium: num(row, 'netPutPremium', 'putPremium'),
        stockPrice: num(row, 'stockPrice', 'price'),
      }))
      .filter((b) => b.t > 0),
  }
}

// ---------------------------------------------------------------------- price

export function mapPrice(raw: unknown, ctx: MapContext): PriceSeries {
  const rows = toRows(payload(raw))

  return {
    ticker: ctx.ticker,
    sessionDate: ctx.sessionDate,
    bars: rows
      .map((row) => ({
        t: num(row, 'timestamp', 'time') || Number(row.__key) || 0,
        o: num(row, 'open', 'o'),
        h: num(row, 'high', 'h'),
        l: num(row, 'low', 'l'),
        c: num(row, 'close', 'c'),
        v: num(row, 'volume', 'v'),
      }))
      .filter((b) => b.t > 0 && b.c > 0),
  }
}

/** Present so a future endpoint can be added without touching the poller. */
export const MAPPERS = {
  'exposure-by-strike': mapExposureByStrike,
  'order-flow': mapOrderFlow,
  'net-drift': mapNetDrift,
  price: mapPrice,
} as const

export { field }
