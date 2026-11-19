import { describe, expect, it } from "vitest"
import { families, generateFrom } from "./support/cases.ts"
import { computedOf, expectAccurate, solve } from "./support/assert-roots.ts"

/** Cases per random family. The full-size run is test/accuracy-report.ts. */
const PER_FAMILY = 25

/** Roots sorted by (re, im), with -0 normalized to 0 for comparisons. */
const sortedRoots = (coeffs: number[]) => {
  const { re, im } = computedOf(solve(coeffs))
  return re.map((x, k) => [x + 0, im[k]! + 0] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

describe("solveQuartic: hand-built cases", () => {
  it("four distinct real roots: (x-1)(x-2)(x-3)(x-4)", () => {
    expectAccurate([1, -10, 35, -50, 24])
  })

  it("x^4 - 1: roots ±1, ±i exactly", () => {
    expect(sortedRoots([1, 0, 0, 0, -1])).toEqual([
      [-1, 0],
      [0, -1],
      [0, 1],
      [1, 0],
    ])
  })

  it("x^4 + 1: roots (±1 ± i)/sqrt(2)", () => {
    const h = Math.SQRT1_2
    for (const [x, y] of sortedRoots([1, 0, 0, 0, 1])) {
      expect(Math.abs(Math.abs(x) - h)).toBeLessThan(2 * Number.EPSILON)
      expect(Math.abs(Math.abs(y) - h)).toBeLessThan(2 * Number.EPSILON)
    }
    expectAccurate([1, 0, 0, 0, 1])
  })

  it("biquadratic x^4 - 5x^2 + 4: roots ±1, ±2", () => {
    expect(sortedRoots([1, 0, -5, 0, 4])).toEqual([
      [-2, 0],
      [-1, 0],
      [1, 0],
      [2, 0],
    ])
  })

  it("exact double root (a grazing contact): (x-1)^2 (x-3)(x+2)", () => {
    const rep = expectAccurate([1, -3, -3, 11, -6])
    expect(rep.exactRealCount).toBe(3)
    // The simple roots stay fully accurate next to the double one.
    const simple = rep.roots.filter((r) => Number.isFinite(r.cond))
    for (const r of simple) expect(r.relError).toBeLessThan(4 * Number.EPSILON)
  })

  it("quadruple root (x-1)^4: roots within eps^(1/4) of 1, backward stable", () => {
    expectAccurate([1, -4, 6, -4, 1])
    for (const [x, y] of sortedRoots([1, -4, 6, -4, 1])) expect(Math.hypot(x - 1, y)).toBeLessThan(5e-4)
  })

  it("grazing ball-ball contact from trajectories: |t + a t^2|^2 = 0", () => {
    // A ball passing another exactly tangentially: distance^2 - (2R)^2 = (t + a t^2)^2,
    // with double roots at t = 0 and t = -1/a.
    const a = -0.981
    expectAccurate([a * a, 2 * a, 1, 0, 0])
  })

  it("zero constant term gives an exact zero root", () => {
    const roots = sortedRoots([1, -6, 11, -6, 0])
    expect(roots[0]).toEqual([0, 0])
    expectAccurate([1, -6, 11, -6, 0])
  })

  it("roots spanning 30 orders of magnitude", () => {
    // (x - 1e-15)(x - 1e-5)(x - 1e5)(x - 1e15), coefficients rounded to float64
    expectAccurate([1, -(1e15 + 1e5 + 1e-5 + 1e-15), 1e20 + 1e10 + 1 + 1 + 1e-10 + 1e-20, -(1e15 + 1e5 + 1e-5 + 1e-15), 1])
  })

  it("nearly equal accelerations (a ~ 1e-30): small roots stay accurate", () => {
    expectAccurate([1e-30, 1e-15, 1, -3, 2])
  })

  it("drops degree when leading coefficients are exactly zero", () => {
    expect(solve([0, 1, -6, 11, -6]).count).toBe(3)
    expect(solve([0, 0, 1, -3, 2]).count).toBe(2) // equal accelerations: a Newton's-cradle setup
    expect(solve([0, 0, 0, 2, -4]).count).toBe(1)
    expect(solve([0, 0, 0, 0, 1]).count).toBe(0)
  })

  it("does not overflow with coefficients near 1e300 or 1e-300", () => {
    expect(sortedRoots([1e300, 0, 0, 0, -1e300])).toEqual([
      [-1, 0],
      [0, -1],
      [0, 1],
      [1, 0],
    ])
    expect(sortedRoots([1e-300, 0, 0, 0, -1e-300])).toEqual([
      [-1, 0],
      [0, -1],
      [0, 1],
      [1, 0],
    ])
  })

  it("propagates NaN input as NaN roots without hanging", () => {
    const r = solve([1, NaN, 0, 0, 1])
    expect(r.count).toBe(4)
    expect(Array.from(r.re).some(Number.isNaN)).toBe(true)
  })
})

describe("solveQuartic: random families against exact roots", () => {
  for (const family of Object.keys(families)) {
    it(family, () => {
      for (const c of generateFrom(families, family, PER_FAMILY, 2026)) expectAccurate(c.coeffs, c.name)
    })
  }
})
