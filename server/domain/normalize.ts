/**
 * Vendor convention #3: `STRIKE_PRICE` = `strikePrice` = `strike_price` =
 * `strike-price` all address the same field. Rather than guessing which spelling
 * a given endpoint returns, resolve all four once — here — so no mapper has to.
 */

const variants = (name: string): string[] => {
  const camel = name.replace(/[-_\s]+(.)/g, (_, c: string) => c.toUpperCase())
  const snake = camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
  return [camel, snake, snake.toUpperCase(), snake.replace(/_/g, '-')]
}

/** First present, non-null value among the aliases (each tried in all 4 spellings). */
export function field(row: Record<string, unknown>, ...aliases: string[]): unknown {
  for (const alias of aliases) {
    for (const key of variants(alias)) {
      const v = row[key]
      if (v !== undefined && v !== null) return v
    }
  }
  return undefined
}

export function num(row: Record<string, unknown>, ...aliases: string[]): number {
  const v = field(row, ...aliases)
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

export function str(row: Record<string, unknown>, ...aliases: string[]): string {
  const v = field(row, ...aliases)
  return v == null ? '' : String(v)
}

/**
 * Vendor ships two response families. Bucket-keyed objects
 * (`{ data: { "<epochMs>": {…} } }`) become a sorted array immediately — React
 * must never iterate object keys and hope the order holds.
 */
export function toRows(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data as Array<Record<string, unknown>>
  if (data && typeof data === 'object') {
    return Object.entries(data as Record<string, Record<string, unknown>>)
      .map(([key, value]) => ({ __key: key, ...value }))
      .sort((a, b) => Number(a.__key) - Number(b.__key))
  }
  return []
}

/** Unwraps `{ data: … }`, tolerating an endpoint that returns the payload bare. */
export function payload(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && 'data' in (raw as Record<string, unknown>)) {
    return (raw as Record<string, unknown>).data
  }
  return raw
}
