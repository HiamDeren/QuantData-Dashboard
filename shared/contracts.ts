/**
 * Provider-neutral DTOs + the SSE frame protocol.
 *
 * This is the ONLY module both server and client import. Vendor JSON never
 * reaches here — `server/vendor/quantdata/` owns raw shapes, mappers convert
 * into these types. A vendor field rename must break exactly one mapper file.
 */

export const DATASETS = ['order-flow', 'exposure-by-strike', 'net-drift', 'price'] as const
export type DatasetId = (typeof DATASETS)[number]

export type ContractType = 'CALL' | 'PUT'

/** Vendor side codes: A/AA = at/above ask (buyer aggression), B/BB = bid, M = mid. */
export type TradeSide = 'A' | 'AA' | 'B' | 'BB' | 'M'
export type TradeType = 'SWEEP' | 'BLOCK' | 'SPLIT' | 'MULTI'

// ---------------------------------------------------------------- order-flow

export interface TapePrint {
  id: string
  ts: number
  ticker: string
  contractType: ContractType
  strike: number
  expiration: string
  dte: number
  side: TradeSide
  tradeType: TradeType
  size: number
  price: number
  premium: number
  spot: number
  iv: number
}

export interface TapeSnapshot {
  ticker: string
  sessionDate: string
  prints: TapePrint[]
}

/** Tape patches append only — the client keeps a bounded ring buffer. */
export interface TapePatch {
  prints: TapePrint[]
}

// -------------------------------------------------------- exposure-by-strike

export type DataMode = 'GEX' | 'DEX' | 'VEX' | 'CHEX'

export interface ExposureStrike {
  strike: number
  gex: number
  dex: number
  vex: number
  chex: number
  callOi: number
  putOi: number
}

/**
 * `dealer-short-calls` is the standard retail assumption, NOT an observed fact.
 * It is a config toggle so the chart can label which convention produced these
 * numbers. See §7 of the domain skill.
 */
export type SignConvention = 'dealer-short-calls' | 'dealer-long-calls'

export interface ExposureProfile {
  ticker: string
  sessionDate: string
  spot: number
  strikes: ExposureStrike[]
  /** Strike with max positive GEX above spot. */
  callWall: number | null
  /** Strike with max |negative GEX| below spot. */
  putWall: number | null
  /** Interpolated price where cumulative GEX crosses zero — not the nearest strike. */
  gammaFlip: number | null
  /** spot > gammaFlip -> dealers suppress vol; spot < flip -> dealers amplify. */
  regime: 'positive' | 'negative' | 'unknown'
  netGex: number
  signConvention: SignConvention
}

// ------------------------------------------------------------------ net-drift

export interface DriftBucket {
  t: number
  netCallPremium: number
  netPutPremium: number
  stockPrice: number
}

export interface NetDrift {
  ticker: string
  sessionDate: string
  buckets: DriftBucket[]
}

// ---------------------------------------------------------------------- price

export interface PriceBar {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface PriceSeries {
  ticker: string
  sessionDate: string
  bars: PriceBar[]
}

// ------------------------------------------------------------ frame protocol

export type ChannelKey = `qd:${DatasetId}:${string}:${string}`

export function channelKey(dataset: DatasetId, ticker: string, sessionDate: string): ChannelKey {
  return `qd:${dataset}:${ticker.toUpperCase()}:${sessionDate}`
}

export interface ParsedChannel {
  dataset: DatasetId
  ticker: string
  sessionDate: string
}

export function parseChannel(key: string): ParsedChannel | null {
  const parts = key.split(':')
  if (parts.length !== 4 || parts[0] !== 'qd') return null
  const [, dataset, ticker, sessionDate] = parts
  if (!DATASETS.includes(dataset as DatasetId)) return null
  return { dataset: dataset as DatasetId, ticker, sessionDate }
}

export type FrameState = 'live' | 'stale' | 'error'

interface FrameBase {
  channel: string
  /** Monotonic per channel. A gap means the client missed a patch -> re-snapshot. */
  seq: number
  ts: number
  /** Age of the underlying vendor payload in ms. Drives the stale badge. */
  staleMs: number
  state: FrameState
}

export interface SnapshotFrame<T = unknown> extends FrameBase {
  type: 'snapshot'
  data: T
}

export interface PatchFrame<T = unknown> extends FrameBase {
  type: 'patch'
  data: T
}

/** Sent when a poll fails — the panel keeps last-good data and shows a badge. */
export interface StatusFrame extends FrameBase {
  type: 'status'
  message?: string
}

export type Frame<T = unknown> = SnapshotFrame<T> | PatchFrame<T> | StatusFrame

/** Payload type per dataset, for typing the client hook. */
export interface DatasetPayload {
  'order-flow': TapeSnapshot
  'exposure-by-strike': ExposureProfile
  'net-drift': NetDrift
  price: PriceSeries
}

export interface SessionUser {
  email: string
  name: string
  initials: string
}
