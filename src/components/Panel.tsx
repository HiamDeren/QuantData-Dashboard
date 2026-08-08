import type { ReactNode } from 'react'

import { fmtStale } from '@/lib/format'
import type { ChannelStatus } from '@/stream/StreamProvider'

interface Props {
  title: string
  tier?: string
  subtitle?: ReactNode
  status?: ChannelStatus
  /** Tier cadence in ms — staleness is judged relative to it, not a fixed clock. */
  cadenceMs?: number
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}

/**
 * A panel NEVER blanks on error: it keeps the last good render and shows a
 * badge. Amber past one cadence, red past 3× — a T2 panel at 40s is fine, a T0
 * panel at 40s is broken, so the threshold has to come from the tier.
 */
function StaleBadge({ status, cadenceMs = 30_000 }: { status?: ChannelStatus; cadenceMs?: number }) {
  if (!status) return null

  const age = status.staleMs + (Date.now() - status.receivedAt)
  const broken = status.state === 'error' || age > cadenceMs * 3
  const stale = age > cadenceMs

  if (!broken && !stale) {
    return (
      <span className="chip text-ink-3" title="Dữ liệu tươi">
        <span className="bg-call size-1.5 rounded-full" aria-hidden="true" />
        live
      </span>
    )
  }

  return (
    <span
      className={`chip ${broken ? 'text-put bg-put/10' : 'text-warn bg-warn/10'}`}
      title={status.message ?? 'Dữ liệu chưa được làm mới'}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      stale {fmtStale(age)}
    </span>
  )
}

export default function Panel({
  title,
  tier,
  subtitle,
  status,
  cadenceMs,
  action,
  children,
  className = '',
  bodyClassName = 'p-3',
}: Props) {
  return (
    <section className={`panel flex min-w-0 flex-col ${className}`}>
      <header className="panel-head">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate text-[13px] font-semibold">{title}</h2>
          {tier && <span className="text-ink-3 shrink-0 text-[10px] font-medium">{tier}</span>}
          {subtitle && <span className="text-ink-3 truncate text-[11px]">{subtitle}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          <StaleBadge status={status} cadenceMs={cadenceMs} />
        </div>
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  )
}

export function PanelEmpty({ label = 'Đang chờ dữ liệu…' }: { label?: string }) {
  return (
    <div className="text-ink-3 grid h-full min-h-[120px] place-items-center text-xs" role="status">
      {label}
    </div>
  )
}
