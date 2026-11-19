/**
 * Accuracy metrics for polynomial root solvers, measured against exact
 * ground truth (see exact.ts).
 *
 * - Forward error: distance from each exact real root to the nearest computed
 *   root, relative to the root's magnitude.
 * - Condition number: how sensitive the root is to relative perturbations of
 *   the coefficients. No float64 algorithm can reliably beat eps * cond, so
 *   the fair score is forward error / (eps * cond), the "stability ratio".
 * - Backward error: the change to each coefficient that would make the
 *   computed roots exact, relative to the size of that coefficient's terms
 *   (see analyze). A backward-stable solver keeps this at a small multiple of
 *   eps.
 */
import {
  abs,
  add,
  derivative,
  div,
  evaluate,
  fromNumber,
  mul,
  polyFromRoots,
  realRoots,
  sub,
  type ExactRoot,
  toNumber,
  type Poly,
  type Rat,
} from "./exact.ts"

export const EPS = Number.EPSILON

export interface ComputedRoots {
  re: number[]
  im: number[]
}

export interface RootReport {
  /** Exact root (rounded to float64 for display). */
  root: number
  /** Relative forward error of the nearest computed root. */
  relError: number
  /** Relative condition number of the root (Infinity for multiple roots). */
  cond: number
  /** relError / (EPS * max(1, cond)). Small means as good as float64 allows. */
  stability: number
  /** Imaginary part of the matched computed root (should be 0 for a simple real root). */
  matchedImag: number
}

export interface Report {
  roots: RootReport[]
  /** Distinct exact real roots. */
  exactRealCount: number
  /** Computed roots with im === 0. */
  computedRealCount: number
  backwardError: number
}

export function toPoly(coeffs: number[]): Poly {
  return coeffs.map(fromNumber)
}

function ratMid(lo: Rat, hi: Rat): Rat {
  return div(add(lo, hi), { n: 2n, d: 1n })
}

function absCoeffPoly(p: Poly): Poly {
  return p.map(abs)
}

/** Exact real roots of a float64 polynomial (pass to analyze to reuse them). */
export function exactRealRoots(coeffs: number[]): ExactRoot[] {
  return realRoots(toPoly(coeffs))
}

export function analyze(coeffs: number[], computed: ComputedRoots, exactRoots?: ExactRoot[]): Report {
  const p = toPoly(coeffs)
  const dp = derivative(p)
  const pAbs = absCoeffPoly(p)
  const exact = exactRoots ?? realRoots(p)

  const roots: RootReport[] = exact.map(({ lo, hi }) => {
    const r = ratMid(lo, hi)
    const rNum = toNumber(r)

    let best = Infinity
    let bestIm = 0
    for (let k = 0; k < computed.re.length; k++) {
      const dRe = toNumber(abs(sub(fromNumber(computed.re[k]!), r)))
      const d = Math.hypot(dRe, computed.im[k]!)
      if (d < best) {
        best = d
        bestIm = computed.im[k]!
      }
    }

    const absR = abs(r)
    const relError = rNum === 0 ? best : best / Math.abs(rNum)
    // cond = sum |a_i| |r|^i / (|r| |p'(r)|)
    const num = toNumber(evaluate(pAbs, absR))
    const den = toNumber(abs(mul(absR, evaluate(dp, r))))
    const cond = den === 0 ? Infinity : num / den
    const stability = relError / (EPS * Math.max(1, cond))
    return { root: rNum, relError, cond, stability, matchedImag: bestIm }
  })

  // Backward error, componentwise against the size of each coefficient's own
  // terms: |rebuilt_j - a_j| / (|lead| * e_j(|z_1|, ..., |z_n|)), where e_j is
  // the j-th elementary symmetric function of the root magnitudes. This is
  // the attainable standard: correctly rounded exact roots score ~1 eps on it,
  // whereas measuring against |a_j| itself is unattainable whenever a_j is
  // small through cancellation (rounded exact roots then reach 85+ eps).
  const lead = p[0]!
  const rebuilt = polyFromRoots(lead, computed.re, computed.im)
  const mags = computed.re.map((x, k) => Math.hypot(x, computed.im[k]!))
  const scale: number[] = [1]
  for (const m of mags) {
    for (let j = scale.length; j >= 1; j--) scale[j] = (scale[j] ?? 0) + m * scale[j - 1]!
  }
  const leadAbs = Math.abs(toNumber(lead))
  let backwardError = 0
  for (let i = 1; i < p.length; i++) {
    const diff = toNumber(abs(sub(rebuilt[i]!, p[i]!)))
    if (diff === 0) continue
    const sc = leadAbs * scale[i]!
    backwardError = Math.max(backwardError, sc === 0 ? Infinity : diff / sc / EPS)
  }

  return {
    roots,
    exactRealCount: exact.length,
    computedRealCount: computed.im.filter((v) => v === 0).length,
    backwardError,
  }
}

/** Deterministic PRNG (mulberry32), so failures are reproducible from a seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Monic coefficients (highest first) of prod (x - r_k) for real/complex roots, in float64. */
export function coeffsFromRoots(roots: { re: number; im: number }[]): number[] {
  let p: { re: number; im: number }[] = [{ re: 1, im: 0 }]
  for (const z of roots) {
    const next = new Array(p.length + 1).fill(null).map(() => ({ re: 0, im: 0 }))
    for (let i = 0; i < p.length; i++) {
      next[i]!.re += p[i]!.re
      next[i]!.im += p[i]!.im
      // -z * p[i]
      next[i + 1]!.re -= z.re * p[i]!.re - z.im * p[i]!.im
      next[i + 1]!.im -= z.re * p[i]!.im + z.im * p[i]!.re
    }
    p = next
  }
  return p.map((c) => c.re)
}
