/**
 * Choosing physically meaningful roots from a solver's output.
 *
 * Near-tangent contacts produce near-double roots, which float64 can return
 * as a complex pair with a tiny imaginary part (see docs/physics-design.md,
 * "Root solving"). A root counts as real when its imaginary part is below an
 * absolute tolerance (for |re| above a cutoff) or a relative one (below it).
 * The thresholds match pooltool 0.6.0's, so the two engines accept the same
 * grazing contacts.
 */
import type { Roots } from "./roots.ts"

export const REAL_CUTOFF = 1e-3
export const REAL_RTOL = 1e-3
export const REAL_ATOL = 1e-9

export function isRealRoot(re: number, im: number): boolean {
  const imag = Math.abs(im)
  const real = Math.abs(re)
  if (real > REAL_CUTOFF) return imag < REAL_ATOL
  if (real > 0) return imag / real < REAL_RTOL
  return imag === 0
}

/** Smallest real root ≥ 0, or Infinity. */
export function smallestNonnegativeReal(roots: Roots): number {
  let best = Infinity
  for (let i = 0; i < roots.count; i++) {
    const re = roots.re[i]!
    if (re >= 0 && re < best && isRealRoot(re, roots.im[i]!)) best = re
  }
  return best
}

/** Real root closest to zero (either sign), or Infinity. */
export function smallestMagnitudeReal(roots: Roots): number {
  let best = Infinity
  let bestMag = Infinity
  for (let i = 0; i < roots.count; i++) {
    const re = roots.re[i]!
    if (Math.abs(re) < bestMag && isRealRoot(re, roots.im[i]!)) {
      best = re
      bestMag = Math.abs(re)
    }
  }
  return best
}
