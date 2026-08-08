import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

/** Latest completed-or-current session, in the vendor's YYYY-MM-DD form. */
export const todaySession = () => new Date().toISOString().slice(0, 10)

export interface Filters {
  ticker: string
  sessionDate: string
}

/**
 * URL search params are the source of truth for the filter set, so any view is
 * shareable and survives a reload. v1 exposes ticker + sessionDate only.
 */
export function useFilters() {
  const [params, setParams] = useSearchParams()

  const filters = useMemo<Filters>(
    () => ({
      ticker: (params.get('ticker') ?? 'SPY').toUpperCase(),
      sessionDate: params.get('date') ?? todaySession(),
    }),
    [params],
  )

  const setFilters = useCallback(
    (next: Partial<Filters>) => {
      setParams(
        (prev) => {
          const merged = new URLSearchParams(prev)
          if (next.ticker) merged.set('ticker', next.ticker.toUpperCase())
          if (next.sessionDate) merged.set('date', next.sessionDate)
          return merged
        },
        { replace: true }, // filter changes should not stack up in history
      )
    },
    [setParams],
  )

  return { filters, setFilters }
}
