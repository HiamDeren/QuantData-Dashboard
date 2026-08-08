import { useMemo, useState } from 'react'

import Panel, { PanelEmpty } from '@/components/Panel'
import { useMeasure } from '@/hooks/useMeasure'
import { abbrev, fmtHm, fmtPrice } from '@/lib/format'
import { useChannel } from '@/stream/StreamProvider'
import type { DriftBucket } from '@shared/contracts'

const PAD = { top: 10, right: 8, bottom: 16, left: 46 }
const PREMIUM_H = 116
const PRICE_H = 74

/**
 * Two stacked frames sharing one x-axis, NOT a dual-axis chart. Premium and
 * price have unrelated scales; overlaying them on two y-axes lets the same data
 * tell any story you crop for. Stacking keeps them comparable in time while
 * each keeps an honest scale of its own.
 *
 * Calls plot upward and puts downward — direction, not colour, carries the
 * call/put distinction (the two hues are not separable for deutan viewers).
 */
export default function NetDriftPanel() {
  const { data, status } = useChannel('net-drift')

  return (
    <Panel
      title="Net Premium Drift"
      tier="T1"
      status={status}
      cadenceMs={20_000}
      subtitle="cộng dồn trong phiên"
      className="min-h-[240px]"
      bodyClassName="p-3"
    >
      {data && data.buckets.length > 1 ? <Drift buckets={data.buckets} /> : <PanelEmpty />}
    </Panel>
  )
}

function Drift({ buckets }: { buckets: DriftBucket[] }) {
  const { ref, width } = useMeasure<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)

  const scales = useMemo(() => {
    const maxPremium = Math.max(...buckets.map((b) => Math.max(b.netCallPremium, b.netPutPremium)), 1)
    const prices = buckets.map((b) => b.stockPrice)
    const lo = Math.min(...prices)
    const hi = Math.max(...prices)
    const pad = (hi - lo) * 0.12 || 1
    return { maxPremium, priceLo: lo - pad, priceHi: hi + pad }
  }, [buckets])

  const w = Math.max(width, 260)
  const plotW = w - PAD.left - PAD.right
  const n = buckets.length

  const x = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const barW = Math.max(1.5, plotW / n - 1.5)

  const midY = PAD.top + PREMIUM_H / 2
  const premiumY = (v: number) => (v / scales.maxPremium) * (PREMIUM_H / 2 - 4)

  const priceTop = PAD.top + PREMIUM_H + 14
  const priceY = (p: number) =>
    priceTop + PRICE_H - ((p - scales.priceLo) / (scales.priceHi - scales.priceLo)) * PRICE_H

  const totalH = priceTop + PRICE_H + PAD.bottom
  const pricePath = buckets
    .map((b, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${priceY(b.stockPrice).toFixed(1)}`)
    .join('')

  const hovered = hover !== null ? buckets[hover] : null

  function handleMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const idx = Math.round(((event.clientX - rect.left - PAD.left) / plotW) * (n - 1))
    setHover(Math.min(n - 1, Math.max(0, idx)))
  }

  return (
    <div ref={ref} className="relative">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[10px]">
        <Legend color="var(--color-call)" label="Call premium (lên)" />
        <Legend color="var(--color-put)" label="Put premium (xuống)" />
        <Legend color="var(--color-accent)" label="Giá" line />
      </div>

      <svg
        width={w}
        height={totalH}
        role="img"
        aria-label="Net premium drift và giá theo thời gian"
        className="touch-none select-none"
        onPointerMove={handleMove}
        onPointerLeave={() => setHover(null)}
      >
        <line x1={PAD.left} x2={w - PAD.right} y1={midY} y2={midY} stroke="var(--color-line)" strokeWidth={1} />

        {buckets.map((b, i) => {
          const dim = hover !== null && hover !== i ? 0.45 : 1
          return (
            <g key={b.t} opacity={dim}>
              <rect
                x={x(i) - barW / 2}
                y={midY - premiumY(b.netCallPremium)}
                width={barW}
                height={Math.max(1, premiumY(b.netCallPremium))}
                fill="var(--color-call)"
                rx={1}
              />
              <rect
                x={x(i) - barW / 2}
                y={midY + 1}
                width={barW}
                height={Math.max(1, premiumY(b.netPutPremium))}
                fill="var(--color-put)"
                rx={1}
              />
            </g>
          )
        })}

        <text x={PAD.left - 6} y={midY - PREMIUM_H / 2 + 8} textAnchor="end" className="num fill-[var(--color-ink-3)] text-[9px]">
          {abbrev(scales.maxPremium)}
        </text>
        <text x={PAD.left - 6} y={midY + PREMIUM_H / 2 - 2} textAnchor="end" className="num fill-[var(--color-ink-3)] text-[9px]">
          {abbrev(scales.maxPremium)}
        </text>

        <path d={pricePath} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" />
        <text x={PAD.left - 6} y={priceTop + 8} textAnchor="end" className="num fill-[var(--color-ink-3)] text-[9px]">
          {scales.priceHi.toFixed(0)}
        </text>
        <text x={PAD.left - 6} y={priceTop + PRICE_H} textAnchor="end" className="num fill-[var(--color-ink-3)] text-[9px]">
          {scales.priceLo.toFixed(0)}
        </text>

        {[0, Math.floor((n - 1) / 2), n - 1].map((i) => (
          <text
            key={i}
            x={x(i)}
            y={totalH - 3}
            textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
            className="num fill-[var(--color-ink-3)] text-[9px]"
          >
            {fmtHm(buckets[i].t)}
          </text>
        ))}

        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={PAD.top}
            y2={priceTop + PRICE_H}
            stroke="var(--color-ink-3)"
            strokeWidth={1}
            strokeDasharray="3 3"
            pointerEvents="none"
          />
        )}
      </svg>

      {hovered && (
        <div
          className="border-line bg-panel-2 pointer-events-none absolute top-6 z-10 rounded-md border p-2 text-[11px] shadow-xl shadow-black/60"
          style={x(hover!) > PAD.left + plotW * 0.6 ? { left: x(hover!) - 150 } : { left: x(hover!) + 10 }}
        >
          <div className="text-ink-3 mb-1 text-[10px]">{fmtHm(hovered.t)}</div>
          <TipRow color="var(--color-call)" label="Call" value={abbrev(hovered.netCallPremium)} />
          <TipRow color="var(--color-put)" label="Put" value={abbrev(hovered.netPutPremium)} />
          <TipRow color="var(--color-accent)" label="Giá" value={fmtPrice(hovered.stockPrice)} />
        </div>
      )}
    </div>
  )
}

function Legend({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="text-ink-2 flex items-center gap-1.5">
      <span
        className={line ? 'h-0.5 w-3.5 rounded-full' : 'size-2 rounded-sm'}
        style={{ background: color }}
        aria-hidden="true"
      />
      {label}
    </span>
  )
}

function TipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="size-1.5 rounded-full" style={{ background: color }} aria-hidden="true" />
      <span className="text-ink-3">{label}</span>
      <span className="num text-ink ml-auto font-semibold">{value}</span>
    </div>
  )
}
