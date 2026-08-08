import { useEffect, useMemo, useRef, useState } from 'react'

import Panel, { PanelEmpty } from '@/components/Panel'
import { useMeasure } from '@/hooks/useMeasure'
import { abbrev, fmtInt, fmtPrice, fmtStrike } from '@/lib/format'
import { useChannel } from '@/stream/StreamProvider'
import type { DataMode, ExposureProfile, ExposureStrike } from '@shared/contracts'

const MODES: DataMode[] = ['GEX', 'DEX', 'VEX', 'CHEX']

const VALUE_OF: Record<DataMode, (s: ExposureStrike) => number> = {
  GEX: (s) => s.gex,
  DEX: (s) => s.dex,
  VEX: (s) => s.vex,
  CHEX: (s) => s.chex,
}

const PAD = { top: 8, right: 14, bottom: 8, left: 52 }
const ROW_H = 11

export default function ExposureProfilePanel() {
  const { data, status } = useChannel('exposure-by-strike')
  const [mode, setMode] = useState<DataMode>('GEX')

  // Fixed height, not min-height: the strike ladder runs ~90 rows, so without a
  // cap the panel grows past the viewport and its internal scroll never engages.
  return (
    <Panel
      title="Dealer Exposure Profile"
      tier="T2"
      status={status}
      cadenceMs={90_000}
      className="h-[560px] xl:h-[calc(100dvh-92px)] xl:max-h-[820px]"
      bodyClassName="p-3 flex flex-col min-h-0"
      action={
        <div className="border-line bg-panel-2 inline-flex rounded border p-0.5">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                mode === m ? 'bg-accent text-[#06121c]' : 'text-ink-3 hover:text-ink'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      }
    >
      {data ? <Profile profile={data} mode={mode} /> : <PanelEmpty />}
    </Panel>
  )
}

function Profile({ profile, mode }: { profile: ExposureProfile; mode: DataMode }) {
  const { ref, width } = useMeasure<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const centredFor = useRef<string | null>(null)

  const valueOf = VALUE_OF[mode]

  // Only strikes within ±6% of spot: the tails are noise and they flatten the
  // bars that matter.
  const rows = useMemo(() => {
    const lo = profile.spot * 0.94
    const hi = profile.spot * 1.06
    return profile.strikes.filter((s) => s.strike >= lo && s.strike <= hi)
  }, [profile])

  // Open the ladder centred on spot. Without this the panel starts at the top of
  // the strike range, which is the least interesting end of it. Re-centres only
  // when the instrument changes, so it never fights the user's scroll on a poll.
  useEffect(() => {
    const el = ref.current
    const key = `${profile.ticker}:${profile.sessionDate}`
    if (!el || rows.length === 0 || centredFor.current === key) return

    const lo = rows[0].strike
    const hi = rows[rows.length - 1].strike
    if (hi === lo) return

    const ratio = (profile.spot - lo) / (hi - lo)
    const spotY = PAD.top + (1 - ratio) * (rows.length - 1) * ROW_H
    el.scrollTop = Math.max(0, spotY - el.clientHeight / 2)
    centredFor.current = key
  }, [ref, rows, profile.spot, profile.ticker, profile.sessionDate])

  if (rows.length === 0) return <PanelEmpty label="Không có strike trong dải ±6%." />

  const w = Math.max(width, 260)
  const h = PAD.top + PAD.bottom + rows.length * ROW_H
  const plotW = w - PAD.left - PAD.right
  const maxAbs = Math.max(...rows.map((s) => Math.abs(valueOf(s))), 1)

  const zeroX = PAD.left + plotW / 2
  const barW = (v: number) => (Math.abs(v) / maxAbs) * (plotW / 2)
  // Strikes ascend upward — the chart reads like a price ladder.
  const y = (i: number) => PAD.top + (rows.length - 1 - i) * ROW_H
  const priceY = (price: number) => {
    const lo = rows[0].strike
    const hi = rows[rows.length - 1].strike
    const ratio = (price - lo) / (hi - lo)
    return PAD.top + (1 - ratio) * (rows.length - 1) * ROW_H + ROW_H / 2
  }

  const hovered = hover !== null ? rows[hover] : null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <StructureRow profile={profile} />

      <div ref={ref} className="relative min-h-0 flex-1 overflow-y-auto">
        <svg width={w} height={h} role="img" aria-label={`${mode} theo strike`} className="select-none">
          <line x1={zeroX} x2={zeroX} y1={PAD.top} y2={h - PAD.bottom} stroke="var(--color-line)" strokeWidth={1} />

          {rows.map((s, i) => {
            const v = valueOf(s)
            const positive = v >= 0
            const width = Math.max(1, barW(v))
            return (
              <g key={s.strike} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                {/* Full-width hit target: an 11px bar is too small to hover reliably. */}
                <rect x={PAD.left} y={y(i)} width={plotW} height={ROW_H} fill="transparent" />
                <rect
                  x={positive ? zeroX : zeroX - width}
                  y={y(i) + 1.5}
                  width={width}
                  height={ROW_H - 3}
                  rx={2}
                  fill={positive ? 'var(--color-gamma-pos)' : 'var(--color-gamma-neg)'}
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
                {i % 4 === 0 && (
                  <text
                    x={PAD.left - 6}
                    y={y(i) + ROW_H / 2}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className="num fill-[var(--color-ink-3)] text-[9px]"
                  >
                    {fmtStrike(s.strike)}
                  </text>
                )}
              </g>
            )
          })}

          <LevelLine y={priceY(profile.spot)} w={w} color="var(--color-accent)" label="SPOT" solid />
          {profile.callWall !== null && (
            <LevelLine y={priceY(profile.callWall)} w={w} color="var(--color-gamma-pos)" label="CALL WALL" />
          )}
          {profile.putWall !== null && (
            <LevelLine y={priceY(profile.putWall)} w={w} color="var(--color-gamma-neg)" label="PUT WALL" />
          )}
          {profile.gammaFlip !== null && (
            <LevelLine y={priceY(profile.gammaFlip)} w={w} color="var(--color-warn)" label="FLIP" />
          )}
        </svg>

        {hovered && (
          <div className="border-line bg-panel-2 pointer-events-none absolute top-2 right-2 z-10 rounded-md border p-2 text-[11px] shadow-xl shadow-black/60">
            <div className="num text-ink mb-1 font-semibold">Strike {fmtStrike(hovered.strike)}</div>
            <Row label={mode} value={abbrev(valueOf(hovered), 2)} />
            <Row label="Call OI" value={fmtInt(hovered.callOi)} />
            <Row label="Put OI" value={fmtInt(hovered.putOi)} />
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-ink-3">{label}</span>
      <span className="num text-ink">{value}</span>
    </div>
  )
}

function LevelLine({
  y,
  w,
  color,
  label,
  solid,
}: {
  y: number
  w: number
  color: string
  label: string
  solid?: boolean
}) {
  return (
    <g pointerEvents="none">
      <line
        x1={PAD.left}
        x2={w - PAD.right}
        y1={y}
        y2={y}
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray={solid ? undefined : '4 3'}
      />
      <text x={w - PAD.right} y={y - 3} textAnchor="end" className="fill-current text-[9px] font-bold" style={{ color }}>
        {label}
      </text>
    </g>
  )
}

/** The structure numbers, each labelled with the formula that produced it. */
function StructureRow({ profile }: { profile: ExposureProfile }) {
  const positive = profile.regime === 'positive'

  return (
    <div className="grid grid-cols-2 gap-1.5 text-[11px] lg:grid-cols-4">
      <Stat
        label="Call Wall"
        value={profile.callWall !== null ? fmtStrike(profile.callWall) : '—'}
        color="var(--color-gamma-pos)"
        title="Strike có GEX dương lớn nhất phía trên spot."
      />
      <Stat
        label="Put Wall"
        value={profile.putWall !== null ? fmtStrike(profile.putWall) : '—'}
        color="var(--color-gamma-neg)"
        title="Strike có |GEX âm| lớn nhất phía dưới spot."
      />
      <Stat
        label="Gamma Flip"
        value={profile.gammaFlip !== null ? fmtStrike(profile.gammaFlip) : '—'}
        color="var(--color-warn)"
        title="Nội suy tuyến tính điểm đổi dấu của GEX theo strike, lấy giao điểm gần spot nhất: flip = Kᵢ + (0 − GEXᵢ)/(GEXᵢ₊₁ − GEXᵢ) × (Kᵢ₊₁ − Kᵢ)"
      />
      <Stat
        label="Spot"
        value={fmtPrice(profile.spot)}
        color="var(--color-accent)"
        title={`Net GEX = ${abbrev(profile.netGex, 2)} · quy ước dấu: ${profile.signConvention}`}
        badge={positive ? 'γ+' : 'γ−'}
      />
    </div>
  )
}

function Stat({
  label,
  value,
  color,
  title,
  badge,
}: {
  label: string
  value: string
  color: string
  title: string
  badge?: string
}) {
  return (
    <div className="bg-panel-2 border-line rounded border px-2 py-1.5" title={title}>
      <div className="text-ink-3 flex items-center gap-1 text-[10px]">
        <span className="size-1.5 rounded-full" style={{ background: color }} aria-hidden="true" />
        {label}
        {badge && <span className="text-ink-2 ml-auto font-bold">{badge}</span>}
      </div>
      <div className="num text-ink mt-0.5 text-[13px] font-semibold">{value}</div>
    </div>
  )
}
