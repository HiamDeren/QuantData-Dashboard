import { useEffect, useState } from 'react'

import RegimeChip from '@/components/RegimeChip'
import Logo from '@/components/layout/Logo'
import { IconLogout } from '@/components/layout/icons'
import { useAuth } from '@/auth/AuthContext'
import { api, type Meta } from '@/lib/api'
import { todaySession, type Filters } from '@/hooks/useFilters'
import { useStream } from '@/stream/StreamProvider'

interface Props {
  filters: Filters
  onChange: (next: Partial<Filters>) => void
}

/**
 * One row of controls above the panels. v1 exposes ticker + session date only;
 * both live in the URL, so a view is shareable and reload-safe.
 */
export default function FilterBar({ filters, onChange }: Props) {
  const { logout } = useAuth()
  const { connected } = useStream()
  const [meta, setMeta] = useState<Meta | null>(null)

  useEffect(() => {
    api.meta().then(setMeta).catch(() => undefined)
  }, [])

  const today = todaySession()

  return (
    <header className="border-line bg-plane/90 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-3 px-3 py-2">
        <Logo />

        <label className="sr-only" htmlFor="ticker">
          Mã
        </label>
        <select
          id="ticker"
          value={filters.ticker}
          onChange={(e) => onChange({ ticker: e.target.value })}
          className="field num w-[92px] font-semibold"
        >
          {(meta?.tickers ?? [filters.ticker]).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="session">
          Phiên
        </label>
        <input
          id="session"
          type="date"
          max={today}
          value={filters.sessionDate}
          onChange={(e) => onChange({ sessionDate: e.target.value })}
          className="field num w-[142px]"
        />

        {filters.sessionDate !== today && (
          <button type="button" onClick={() => onChange({ sessionDate: today })} className="btn-ghost">
            Về phiên hôm nay
          </button>
        )}

        <RegimeChip />

        <div className="ml-auto flex items-center gap-2">
          {meta?.vendor === 'mock' && (
            <span className="chip bg-warn/10 text-warn" title="Chưa cấu hình QD_API_KEY — dữ liệu là mô phỏng.">
              MOCK DATA
            </span>
          )}
          <span
            className={`chip ${connected ? 'text-ink-3' : 'bg-put/10 text-put'}`}
            title={connected ? 'SSE đang kết nối' : 'Mất kết nối — EventSource đang thử lại'}
          >
            <span
              className={`size-1.5 rounded-full ${connected ? 'bg-call' : 'bg-put'}`}
              aria-hidden="true"
            />
            {connected ? 'stream' : 'mất kết nối'}
          </span>
          <button type="button" onClick={logout} className="btn-ghost" aria-label="Đăng xuất">
            <IconLogout className="size-4" />
          </button>
        </div>
      </div>
    </header>
  )
}
