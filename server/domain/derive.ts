import type { ExposureStrike, SignConvention } from '../../shared/contracts.js'

export interface DerivedStructure {
  callWall: number | null
  putWall: number | null
  gammaFlip: number | null
  regime: 'positive' | 'negative' | 'unknown'
  netGex: number
}

/**
 * The vendor already ships greek-weighted exposure, so nothing here recomputes
 * gamma — this derives only the STRUCTURE on top of it (§7 of the domain skill).
 *
 * Every number produced here is reproducible from `strikes` + `spot` alone; the
 * UI shows the formula in a tooltip. A dashboard number nobody can reproduce is
 * a liability.
 */
export function deriveStructure(
  strikes: ExposureStrike[],
  spot: number,
  convention: SignConvention,
): DerivedStructure {
  if (strikes.length === 0 || !Number.isFinite(spot)) {
    return { callWall: null, putWall: null, gammaFlip: null, regime: 'unknown', netGex: 0 }
  }

  const sorted = [...strikes].sort((a, b) => a.strike - b.strike)

  /*
   * The WALLS and the FLIP are read off the vendor's raw GEX, deliberately
   * unflipped. They are gamma-concentration levels in the chain — where call
   * open interest piles up above spot, where put open interest piles up below —
   * and that structure does not move when you change your assumption about
   * which side the dealer is on. Negating every bar also cannot move a sign
   * change, so the flip price is convention-invariant too.
   *
   * Only the REGIME LABEL depends on the convention, because only the question
   * "are dealers damping or amplifying" depends on their side of the book.
   * Flipping the sign before computing the walls (an earlier version of this
   * file) inverts which side of spot each wall is hunted on and makes both come
   * back null on a normal chain.
   */
  const gexAt = (s: ExposureStrike) => s.gex

  let callWall: number | null = null
  let putWall: number | null = null
  let maxAbove = 0
  let maxBelow = 0
  let rawNet = 0

  for (const s of sorted) {
    const g = gexAt(s)
    rawNet += g
    if (s.strike > spot && g > maxAbove) {
      maxAbove = g
      callWall = s.strike
    }
    if (s.strike < spot && g < maxBelow) {
      maxBelow = g
      putWall = s.strike
    }
  }

  const gammaFlip = interpolateGexSignChange(sorted, gexAt, spot)

  // Net GEX is reported under the ACTIVE convention — it is a signed aggregate
  // the user reads as "how much damping is in the book", so its sign must match
  // the regime shown beside it.
  const conventionSign = convention === 'dealer-long-calls' ? 1 : -1
  const netGex = rawNet * conventionSign

  // Standard (dealer-long-calls) reading: spot above the flip = positive gamma.
  // The opposite assumption inverts exactly this label and nothing else.
  const rawRegime = gammaFlip === null ? (rawNet >= 0 ? 'positive' : 'negative') : spot >= gammaFlip ? 'positive' : 'negative'
  const regime = conventionSign === 1 ? rawRegime : rawRegime === 'positive' ? 'negative' : 'positive'

  return { callWall, putWall, gammaFlip, regime, netGex }
}

/**
 * Zero Gamma Flip — the price separating the put-dominated (negative gamma)
 * strikes below from the call-dominated (positive gamma) strikes above. Found by
 * linear-interpolating the per-strike GEX profile across its sign change, taking
 * the crossing nearest spot when there are several (common on pinned days).
 *
 * FORMULA (shown in the UI tooltip):
 *   flip = K_i + (0 - GEX_i) / (GEX_{i+1} - GEX_i) * (K_{i+1} - K_i)
 *   for the adjacent strike pair where sign(GEX) changes, nearest spot.
 *
 * DELIBERATE DEVIATION from the "cumulative GEX crosses zero" phrasing: the
 * running-sum-across-strikes crossing is not a spot-anchored level. Measured on
 * a synthetic chain it sits 2–4% above spot and slides monotonically with total
 * call/put imbalance — it marks where the running total happens to zero out, and
 * it does not exist at all for a put-dominant chain (the usual index case).
 * The profile sign change uses only vendor per-strike GEX, needs no pricing
 * model, and is exactly the level the exposure chart draws.
 */
function interpolateGexSignChange(
  sorted: ExposureStrike[],
  gexAt: (s: ExposureStrike) => number,
  spot: number,
): number | null {
  let best: number | null = null
  let bestDistance = Infinity

  for (let i = 1; i < sorted.length; i++) {
    const prev = { strike: sorted[i - 1].strike, gex: gexAt(sorted[i - 1]) }
    const curr = { strike: sorted[i].strike, gex: gexAt(sorted[i]) }

    if (prev.gex === 0) return prev.strike
    if (prev.gex > 0 === curr.gex > 0) continue

    const span = curr.gex - prev.gex
    if (span === 0) continue
    const crossing = prev.strike + ((0 - prev.gex) / span) * (curr.strike - prev.strike)

    const distance = Math.abs(crossing - spot)
    if (distance < bestDistance) {
      bestDistance = distance
      best = Number(crossing.toFixed(2))
    }
  }

  return best
}
