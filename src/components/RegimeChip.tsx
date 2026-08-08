import { abbrev, fmtStrike } from '@/lib/format'
import { useChannel } from '@/stream/StreamProvider'

/**
 * The single highest-value element on the page: which side of the gamma flip
 * price is on, and therefore whether dealer hedging is suppressing or amplifying
 * moves. Label + sign carry the meaning; colour only reinforces it.
 */
export default function RegimeChip() {
  const { data } = useChannel('exposure-by-strike')

  if (!data) {
    return (
      <span className="chip bg-panel-2 text-ink-3 px-2 py-1">
        <span className="bg-ink-3 size-2 rounded-full" aria-hidden="true" />
        Chế độ gamma: —
      </span>
    )
  }

  const positive = data.regime === 'positive'
  const color = positive ? 'var(--color-gamma-pos)' : 'var(--color-gamma-neg)'

  return (
    <span
      className="chip gap-2 px-2.5 py-1 text-xs"
      style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
      title={
        `Net GEX = ${abbrev(data.netGex, 2)} · quy ước dấu: ${data.signConvention}. ` +
        (positive
          ? 'Spot trên gamma flip: dealer hedge ngược chiều giá -> nén biến động, thiên về mean-reversion.'
          : 'Spot dưới gamma flip: dealer hedge cùng chiều giá -> khuếch đại biến động, thiên về trend.')
      }
    >
      <span className="size-2 rounded-full bg-current" aria-hidden="true" />
      <span className="font-bold">{positive ? 'POSITIVE GAMMA' : 'NEGATIVE GAMMA'}</span>
      <span className="text-ink-2 font-normal">
        {positive ? 'nén biến động' : 'khuếch đại biến động'}
        {data.gammaFlip !== null && (
          <>
            {' · flip '}
            <span className="num">{fmtStrike(data.gammaFlip)}</span>
          </>
        )}
      </span>
    </span>
  )
}
