/** Abbreviated premium (`24.3M`). Tooltips keep full precision. */
export function abbrev(value: number, digits = 1): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(digits)}B`
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(digits)}M`
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(digits)}K`
  return `${sign}${abs.toFixed(0)}`
}

export const signedAbbrev = (v: number) => `${v >= 0 ? '+' : '−'}${abbrev(Math.abs(v))}`

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export const fmtPrice = (v: number) => usd.format(v)
export const fmtStrike = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2))
export const fmtInt = (v: number) => new Intl.NumberFormat('en-US').format(Math.round(v))

export const fmtClock = (t: number) =>
  new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export const fmtHm = (t: number) =>
  new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

export function fmtStale(ms: number): string {
  if (ms < 1_000) return 'now'
  if (ms < 60_000) return `${Math.floor(ms / 1_000)}s`
  return `${Math.floor(ms / 60_000)}m`
}
