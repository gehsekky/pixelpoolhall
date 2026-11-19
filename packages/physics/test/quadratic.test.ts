import { describe, expect, it } from "vitest"
import { createRoots, solveQuadratic } from "../src/index.ts"

const out = createRoots()
const roots = () =>
  Array.from({ length: out.count }, (_, k) => [out.re[k]!, out.im[k]!] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1])

describe("solveQuadratic", () => {
  it("solves distinct real roots", () => {
    expect(solveQuadratic(1, -3, 2, out)).toBe(2)
    expect(roots()).toEqual([
      [1, 0],
      [2, 0],
    ])
  })

  it("keeps the small root accurate when b^2 >> 4ac (no cancellation)", () => {
    // Roots 1e-8 and 1e8; the textbook formula loses the small one entirely.
    solveQuadratic(1, -(1e8 + 1e-8), 1, out)
    const [small, large] = roots()
    expect(Math.abs(small![0] - 1e-8) / 1e-8).toBeLessThan(4 * Number.EPSILON)
    expect(Math.abs(large![0] - 1e8) / 1e8).toBeLessThan(4 * Number.EPSILON)
  })

  it("returns an exact double root", () => {
    solveQuadratic(1, -2, 1, out)
    expect(roots()).toEqual([
      [1, 0],
      [1, 0],
    ])
  })

  it("resolves a near-double root using the error-free discriminant", () => {
    // (x - 1)(x - (1 + 2^-26)): b^2 - 4ac = 2^-52, which the naive product rounds to 0.
    const d = 2 ** -26
    solveQuadratic(1, -(2 + d), 1 + d, out)
    const [a, b] = roots()
    expect(a).toEqual([1, 0])
    expect(b).toEqual([1 + d, 0])
  })

  it("returns a complex-conjugate pair", () => {
    solveQuadratic(1, 2, 5, out) // -1 ± 2i
    expect(roots()).toEqual([
      [-1, -2],
      [-1, 2],
    ])
  })

  it("drops to the linear case when a = 0", () => {
    expect(solveQuadratic(0, 2, -4, out)).toBe(1)
    expect(roots()).toEqual([[2, 0]])
  })

  it("returns no roots for a constant", () => {
    expect(solveQuadratic(0, 0, 3, out)).toBe(0)
  })

  it("does not overflow with huge or tiny coefficients", () => {
    // The coefficients are not exact multiples of (1, -3, 2), so the roots are
    // only expected to within an ulp or two.
    for (const k of [1e300, 1e-300]) {
      solveQuadratic(k, -3 * k, 2 * k, out)
      const [a, b] = roots()
      expect(Math.abs(a![0] - 1)).toBeLessThanOrEqual(2 * Number.EPSILON)
      expect(Math.abs(b![0] - 2)).toBeLessThanOrEqual(4 * Number.EPSILON)
      expect(a![1]).toBe(0)
      expect(b![1]).toBe(0)
    }
  })
})
