import { expect } from "vitest"
import { createRoots, solveCubic, solveQuartic, type Roots } from "../../src/index.ts"
import { analyze, type Report } from "./metrics.ts"

/** Thresholds every solve must meet (units of eps). Observed maxima are ~2. */
export const MAX_STABILITY = 8
export const MAX_BACKWARD_ERROR = 8

const out = createRoots()

export function solve(coeffs: number[]): Roots {
  if (coeffs.length === 5) solveQuartic(coeffs[0]!, coeffs[1]!, coeffs[2]!, coeffs[3]!, coeffs[4]!, out)
  else if (coeffs.length === 4) solveCubic(coeffs[0]!, coeffs[1]!, coeffs[2]!, coeffs[3]!, out)
  else throw new Error("degree 3 or 4 only")
  return out
}

export function computedOf(r: Roots): { re: number[]; im: number[] } {
  return { re: Array.from(r.re.subarray(0, r.count)), im: Array.from(r.im.subarray(0, r.count)) }
}

/**
 * Solves and checks against exact ground truth:
 *  - componentwise backward error <= MAX_BACKWARD_ERROR eps;
 *  - every simple real root within MAX_STABILITY * eps * cond;
 *  - real-root count matches, unless the backward error shows float64 cannot
 *    decide the real/complex split.
 */
export function expectAccurate(coeffs: number[], label = JSON.stringify(coeffs)): Report {
  const r = solve(coeffs)
  const rep = analyze(coeffs, computedOf(r))
  expect(rep.backwardError, `${label}: backward error (eps)`).toBeLessThanOrEqual(MAX_BACKWARD_ERROR)
  for (const root of rep.roots) {
    if (!Number.isFinite(root.cond)) continue // multiple root: covered by backward error
    expect(root.stability, `${label}: root ${root.root} stability`).toBeLessThanOrEqual(MAX_STABILITY)
  }
  if (rep.backwardError > 4) {
    expect(rep.computedRealCount, `${label}: real root count`).toBe(rep.exactRealCount)
  }
  return rep
}
