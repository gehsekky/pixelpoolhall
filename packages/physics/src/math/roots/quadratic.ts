import { diffOfProducts } from "../eft.ts"
import { powerOfTwoAtLeast, type Roots } from "./roots.ts"

/**
 * Solves a*x^2 + b*x + c = 0 into `out`. Returns the number of roots.
 *
 * - a = 0 drops to the linear case (one root), and a = b = 0 gives no roots.
 * - The discriminant is computed with an error-free product, so near-double
 *   roots (grazing contacts) keep their accuracy.
 * - The two real roots use the cancellation-free pair q/a and c/q.
 */
export function solveQuadratic(a: number, b: number, c: number, out: Roots): number {
  out.count = quadraticInto(a, b, c, out, 0)
  return out.count
}

/**
 * Writes the roots of a*x^2 + b*x + c into `out` starting at index `offset`,
 * without touching `out.count`. Returns the number of roots written.
 */
export function quadraticInto(
  a: number,
  b: number,
  c: number,
  out: Roots,
  offset: number,
): number {
  const re = out.re
  const im = out.im

  if (a === 0) {
    if (b === 0) return 0
    re[offset] = -c / b
    im[offset] = 0
    return 1
  }

  // Normalize magnitudes by an exact power of two so b*b and a*c cannot
  // overflow or needlessly underflow.
  const m = Math.max(Math.abs(a), Math.abs(b), Math.abs(c))
  const s = powerOfTwoAtLeast(m)
  a /= s
  b /= s
  c /= s

  const disc = diffOfProducts(b, b, 4 * a, c)

  if (disc >= 0) {
    const root = Math.sqrt(disc)
    // q has the same sign as b, so b + sign(b)*root never cancels.
    const q = -0.5 * (b >= 0 ? b + root : b - root)
    if (q === 0) {
      // Only when b = 0 and disc = 0, which forces c = 0: a double root at 0.
      re[offset] = 0
      re[offset + 1] = 0
    } else {
      re[offset] = q / a
      re[offset + 1] = c / q
    }
    im[offset] = 0
    im[offset + 1] = 0
  } else {
    const real = -b / (2 * a)
    const imag = Math.sqrt(-disc) / (2 * Math.abs(a))
    re[offset] = real
    im[offset] = imag
    re[offset + 1] = real
    im[offset + 1] = -imag
  }
  return 2
}
