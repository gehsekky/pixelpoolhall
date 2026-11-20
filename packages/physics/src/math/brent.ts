/**
 * Brent's method for a root of f in [a, b], where f(a) and f(b) have opposite
 * signs (or one is zero). Combines bisection, the secant method and inverse
 * quadratic interpolation; guaranteed to converge, superlinear near simple
 * roots.
 *
 * Written from R. P. Brent, "Algorithms for Minimization without
 * Derivatives" (1973), ch. 4, procedure `zero`.
 *
 * @param tol absolute tolerance on x; the result is within 4·eps·|x| + tol of a root
 */
export function brent(f: (x: number) => number, a: number, b: number, tol = 0): number {
  let fa = f(a)
  let fb = f(b)
  if (fa === 0) return a
  if (fb === 0) return b
  if (Math.sign(fa) === Math.sign(fb)) throw new RangeError(`brent: f(a) and f(b) have the same sign on [${a}, ${b}]`)
  let c = a
  let fc = fa
  let d = b - a
  let e = d
  for (let iter = 0; iter < 200; iter++) {
    if (Math.sign(fb) === Math.sign(fc)) {
      c = a
      fc = fa
      d = b - a
      e = d
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b
      b = c
      c = a
      fa = fb
      fb = fc
      fc = fa
    }
    const t = 2 * Number.EPSILON * Math.abs(b) + tol
    const m = 0.5 * (c - b)
    if (Math.abs(m) <= t || fb === 0) return b
    if (Math.abs(e) < t || Math.abs(fa) <= Math.abs(fb)) {
      d = m
      e = m
    } else {
      let s = fb / fa
      let p: number
      let q: number
      if (a === c) {
        // Secant step.
        p = 2 * m * s
        q = 1 - s
      } else {
        // Inverse quadratic interpolation.
        const qq = fa / fc
        const r = fb / fc
        p = s * (2 * m * qq * (qq - r) - (b - a) * (r - 1))
        q = (qq - 1) * (r - 1) * (s - 1)
      }
      if (p > 0) q = -q
      else p = -p
      s = e
      e = d
      if (2 * p < 3 * m * q - Math.abs(t * q) && p < Math.abs(0.5 * s * q)) {
        d = p / q
      } else {
        d = m
        e = m
      }
    }
    a = b
    fa = fb
    b += Math.abs(d) > t ? d : m > 0 ? t : -t
    fb = f(b)
  }
  return b
}
