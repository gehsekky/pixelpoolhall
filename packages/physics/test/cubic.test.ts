import { describe, expect, it } from "vitest"
import { cubicFamilies, generateFrom } from "./support/cases.ts"
import { expectAccurate, solve } from "./support/assert-roots.ts"

/** Cases per random family. The full-size run is test/accuracy-report.ts. */
const PER_FAMILY = 25

describe("solveCubic: hand-built cases", () => {
  it("three distinct real roots: (x-1)(x-2)(x-3)", () => {
    expectAccurate([1, -6, 11, -6])
  })

  it("one real root and a complex pair: (x-2)(x^2+1)", () => {
    expectAccurate([1, -2, 1, -2])
  })

  it("exact double root: (x-1)^2 (x-3)", () => {
    expectAccurate([1, -5, 7, -3])
  })

  it("triple root: (x-2)^3", () => {
    const rep = expectAccurate([1, -6, 12, -8])
    expect(rep.exactRealCount).toBe(1)
  })

  it("zero constant term gives an exact zero root", () => {
    const r = solve([1, -3, 2, 0])
    expect(Array.from(r.re.subarray(0, 3)).sort()).toEqual([0, 1, 2])
  })

  it("roots spanning 30 orders of magnitude", () => {
    // (x - 1e-15)(x - 1)(x - 1e15)
    expectAccurate([1, -(1e15 + 1 + 1e-15), 1e15 + 1 + 1, -1])
  })

  it("drops to quadratic and linear when leading coefficients are zero", () => {
    expect(solve([0, 1, -3, 2]).count).toBe(2)
    expect(solve([0, 0, 2, -4]).count).toBe(1)
  })
})

describe("solveCubic: random families against exact roots", () => {
  for (const family of Object.keys(cubicFamilies)) {
    it(family, () => {
      for (const c of generateFrom(cubicFamilies, family, PER_FAMILY, 2026)) expectAccurate(c.coeffs, c.name)
    })
  }
})
