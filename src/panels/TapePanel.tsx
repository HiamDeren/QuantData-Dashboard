import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import Panel, { PanelEmpty } from '@/components/Panel'
import { abbrev, fmtClock, fmtInt, fmtStrike } from '@/lib/format'
import { useChannel } from '@/stream/StreamProvider'
import type { TapePrint } from '@shared/contracts'

const ROW_H = 26
const MIN_PREMIUMS = [0, 25_000, 100_000, 500_000] as const

/** Premium heat: bigger prints get a stronger left rail, not a bigger font. */
function heatOpacity(premium: number): number {
  if (premium >= 1_000_000) return 1
  if (premium >= 250_000) return 0.7
  if (premium >= 50_000) return 0.4
  return 0.18
}

/**
 * Fixed height, not min-height: the virtualizer sizes its spacer to the FULL
 * buffer (2,000 rows ≈ 52,000px). Without a bounded parent that spacer becomes
 * the document height and the page scrolls into empty space.
 */
export default function TapePanel() {
  const { data, status } = useChannel('order-flow')
  const [minPremium, setMinPremium] = useState<number>(0)

  const prints = useMemo(
    () => (data?.prints ?? []).filter((p) => p.premium >= minPremium),
    [data, minPremium],
  )

  return (
    <Panel
      title="Live Options Tape"
      tier="T0"
      status={status}
      cadenceMs={4_000}
      subtitle={data ? `${fmtInt(prints.length)} prints` : undefined}
      className="h-[420px]"
      bodyClassName="p-0 flex flex-col min-h-0"
      action={
        <div className="border-line bg-panel-2 inline-flex rounded border p-0.5">
          {MIN_PREMIUMS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setMinPremium(v)}
              aria-pressed={minPremium === v}
              className={`rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                minPremium === v ? 'bg-accent text-[#06121c]' : 'text-ink-3 hover:text-ink'
              }`}
            >
              {v === 0 ? 'ALL' : `≥${abbrev(v, 0)}`}
            </button>
          ))}
        </div>
      }
    >
      {prints.length === 0 ? <PanelEmpty label="Chưa có lệnh nào." /> : <TapeRows prints={prints} />}
    </Panel>
  )
}

function TapeRows({ prints }: { prints: TapePrint[] }) {
  const parentRef = useRef<HTMLDivElement>(null)
  // Only rows that arrived this render flash — re-flashing the whole buffer on
  // every patch would strobe the panel.
  const seenRef = useRef<Set<string>>(new Set())
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const seen = seenRef.current
    const fresh = new Set<string>()
    for (const p of prints.slice(0, 40)) {
      if (!seen.has(p.id)) fresh.add(p.id)
    }
    for (const p of prints) seen.add(p.id)
    // Bound the dedupe set alongside the ring buffer.
    if (seen.size > 4_000) seenRef.current = new Set(prints.map((p) => p.id))

    if (fresh.size > 0) {
      setFreshIds(fresh)
      const timer = setTimeout(() => setFreshIds(new Set()), 200)
      return () => clearTimeout(timer)
    }
  }, [prints])

  const virtualizer = useVirtualizer({
    count: prints.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="text-ink-3 border-line grid shrink-0 grid-cols-[64px_44px_60px_54px_60px_1fr_72px] gap-2 border-b px-3 py-1.5 text-[10px] font-medium">
        <span>Giờ</span>
        <span>Loại</span>
        <span className="text-right">Strike</span>
        <span className="text-right">DTE</span>
        <span className="text-right">KL</span>
        <span>Kiểu / Side</span>
        <span className="text-right">Premium</span>
      </div>

      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const p = prints[item.index]
            const call = p.contractType === 'CALL'
            return (
              <div
                key={p.id}
                className={`border-line/60 hover:bg-panel-2 absolute top-0 left-0 grid w-full grid-cols-[64px_44px_60px_54px_60px_1fr_72px] items-center gap-2 border-b px-3 text-[11px] ${
                  freshIds.has(p.id) ? (call ? 'flash-call' : 'flash-put') : ''
                }`}
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
              >
                <span className="num text-ink-3">{fmtClock(p.ts)}</span>
                {/* CALL/PUT is spelled out — these two colours are not separable
                    for deutan viewers, so the label carries the meaning. */}
                <span className={`font-bold ${call ? 'text-call' : 'text-put'}`}>{p.contractType}</span>
                <span className="num text-right">{fmtStrike(p.strike)}</span>
                <span className="num text-ink-2 text-right">{p.dte === 0 ? '0DTE' : `${p.dte}d`}</span>
                <span className="num text-right">{fmtInt(p.size)}</span>
                <span className="text-ink-2 flex items-center gap-1.5 truncate">
                  <span className="bg-panel-2 border-line rounded border px-1 text-[9px] font-semibold">
                    {p.tradeType}
                  </span>
                  <span className="text-ink-3 text-[10px]">{p.side}</span>
                </span>
                <span className="flex items-center justify-end gap-1.5">
                  <span
                    className="h-3 w-0.5 rounded-full"
                    style={{
                      background: call ? 'var(--color-call)' : 'var(--color-put)',
                      opacity: heatOpacity(p.premium),
                    }}
                    aria-hidden="true"
                  />
                  <span className="num font-semibold" title={`$${fmtInt(p.premium)}`}>
                    {abbrev(p.premium)}
                  </span>
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
