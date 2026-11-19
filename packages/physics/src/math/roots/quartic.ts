import { aberth } from "./aberth.ts"
import { backwardError } from "./certify.ts"
import { cubicInto, largestRealCubicRoot } from "./cubic.ts"
import { polishRoot } from "./polish.ts"
import { quadraticInto } from "./quadratic.ts"
import { powerOfTwoAtLeast, type Roots } from "./roots.ts"

/**
 * Quartic solver, written from the classical mathematics (clean-room; see
 * docs/physics-design.md, "Root solving").
 *
 * Steps:
 *  1. Normalize to a monic quartic x^4 + b x^3 + c x^2 + d x + e and scale
 *     x = s*y by an exact power of two so every coefficient is <= 1.
 *  2. Ferrari's method: depress (y = x - b/4), take the largest root of the
 *     resolvent cubic, and split into two real quadratic factors
 *     (x^2 + a1 x + b1)(x^2 + a2 x + b2).
 *  3. Refine the factor coefficients (a1, b1, a2, b2) with Newton's method on
 *     the four equations that match the product to (b, c, d, e). This repairs
 *     the cancellation Ferrari's formulas suffer, and is kept only while the
 *     coefficient residual shrinks.
 *  4. Solve both quadratics (cancellation-free, error-free discriminant).
 *  5. Polish every root with guarded Newton steps on the quartic itself.
 *  6. Certify: multiply the roots back out and check every coefficient
 *     (componentwise backward error). If the check fails, which happens when
 *     roots differ in magnitude by many orders, recompute with Aberth's method
 *     (aberth.ts), regroup into real quadratic factors, and repeat steps 3-5.
 *     The result with the smaller backward error is returned.
 */

const coef = new Float64Array(4)
/** Factor coefficients [a1, b1, a2, b2]. */
const fac = new Float64Array(4)
/** 4x4 Jacobian augmented with the right-hand side, row-major 4x5. */
const jac = new Float64Array(20)
const step = new Float64Array(4)
/** Fallback scratch: Aberth roots, and the fast path's roots kept for comparison. */
const zr = new Float64Array(4)
const zi = new Float64Array(4)
const keepRe = new Float64Array(4)
const keepIm = new Float64Array(4)
/** Roots before polishing, restored if polishing makes the set worse. */
const polishRe = new Float64Array(4)
const polishIm = new Float64Array(4)

/** Max Newton iterations on the factorization (each one roughly doubles the correct digits). */
const FACTOR_ITERATIONS = 8
/** Max guarded Newton iterations per root on the quartic. */
const POLISH_ITERATIONS = 2
/** Backward error (in eps) at or below which roots are not polished. */
const POLISH_SKIP = 2
/** Factorization residual (componentwise, summed) treated as converged. */
const FACTOR_CONVERGED = 2 * Number.EPSILON
/**
 * Componentwise backward error (in eps) above which the closed-form result is
 * not trusted and the Aberth fallback runs.
 */
const CERTIFY_TOLERANCE = 4

/** Counters for tests and benchmarks: how often the fallback path runs. */
export const quarticStats = { calls: 0, fallbacks: 0 }

/**
 * Solves a*x^4 + b*x^3 + c*x^2 + d*x + e = 0 into `out`. Returns the number of
 * roots (4, or fewer when leading coefficients are exactly zero).
 *
 * Callers that build coefficients from physics (collision detection) should
 * pass exact zeros for vanishing leading terms, for example two balls with the
 * same acceleration, so the solver drops to the lower degree.
 */
export function solveQuartic(
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  out: Roots,
): number {
  if (a === 0) {
    out.count = cubicInto(b, c, d, e, out, 0)
    return out.count
  }

  b /= a
  c /= a
  d /= a
  e /= a

  const re = out.re
  const im = out.im

  if (e === 0) {
    re[0] = 0
    im[0] = 0
    out.count = 1 + cubicInto(1, b, c, d, out, 1)
    return out.count
  }

  const s = powerOfTwoAtLeast(
    Math.max(Math.abs(b), Math.sqrt(Math.abs(c)), Math.cbrt(Math.abs(d)), Math.sqrt(Math.sqrt(Math.abs(e)))),
  )
  const s2 = s * s
  coef[0] = b / s
  coef[1] = c / s2
  coef[2] = d / (s2 * s)
  coef[3] = e / (s2 * s2)
  quarticStats.calls++

  // Fast path: Ferrari's factorization.
  ferrariFactorization(coef[0], coef[1], coef[2], coef[3])
  let err = finishFromFactors(out)

  if (err > CERTIFY_TOLERANCE) {
    // Robust path: Aberth's method, regrouped into real quadratic factors.
    quarticStats.fallbacks++
    keepRe.set(re)
    keepIm.set(im)
    aberth(coef, 4, zr, zi)
    pairIntoFactors()
    const err2 = finishFromFactors(out)
    if (!(err2 < err)) {
      re.set(keepRe)
      im.set(keepIm)
    } else {
      err = err2
    }
  }

  for (let k = 0; k < 4; k++) {
    re[k] *= s
    im[k] *= s
  }
  out.count = 4
  return 4
}

/**
 * From an initial factorization in `fac`: refine it, solve both quadratics,
 * polish the roots, and return the componentwise backward error (in eps).
 */
function finishFromFactors(out: Roots): number {
  refineFactorization(coef[0], coef[1], coef[2], coef[3])
  quadraticInto(1, fac[0], fac[1], out, 0)
  quadraticInto(1, fac[2], fac[3], out, 2)

  const re = out.re
  const im = out.im
  const before = backwardError(coef, 4, re, im, 0)
  // Already as exact as float64 allows: polishing cannot help.
  if (before <= POLISH_SKIP) return before
  polishRe.set(re)
  polishIm.set(im)
  for (let k = 0; k < 4; k++) {
    if (im[k] < 0) continue // conjugate of the previous root; mirrored below
    polishRoot(coef, 4, out, k, POLISH_ITERATIONS)
    if (im[k] > 0) {
      re[k + 1] = re[k]
      im[k + 1] = -im[k]
    }
  }
  // Polishing improves each root alone but can pull the two members of a
  // close pair toward the same point. Keep it only if the root set as a whole
  // is at least as accurate.
  const after = backwardError(coef, 4, re, im, 0)
  if (after <= before) return after
  re.set(polishRe)
  im.set(polishIm)
  return before
}

/**
 * Groups the four Aberth roots in zr/zi into two pairs whose sums and products
 * are (nearly) real, i.e. conjugate pairs together and real roots together,
 * and writes the resulting real quadratic factors to `fac`.
 */
function pairIntoFactors(): void {
  // The three ways to split {0,1,2,3} into two pairs.
  let best = Infinity
  let bestA = 0
  let bestB = 1
  let bestC = 2
  let bestD = 3
  for (let option = 0; option < 3; option++) {
    const a = 0
    const b = option + 1
    const c = option === 0 ? 2 : 1
    const d = option === 2 ? 2 : 3
    const defect = pairDefect(a, b) + pairDefect(c, d)
    if (defect < best) {
      best = defect
      bestA = a
      bestB = b
      bestC = c
      bestD = d
    }
  }
  setFactor(bestA, bestB, 0)
  setFactor(bestC, bestD, 2)
}

/** How far from real the quadratic factor (x - z_a)(x - z_b) is, relatively. */
function pairDefect(a: number, b: number): number {
  const sumIm = Math.abs(zi[a] + zi[b])
  const prodIm = Math.abs(zr[a] * zi[b] + zi[a] * zr[b])
  const ma = Math.hypot(zr[a], zi[a])
  const mb = Math.hypot(zr[b], zi[b])
  const sumScale = ma + mb
  const prodScale = ma * mb
  return (sumScale > 0 ? sumIm / sumScale : 0) + (prodScale > 0 ? prodIm / prodScale : 0)
}

/** fac[at], fac[at+1] = coefficients of the real part of (x - z_a)(x - z_b). */
function setFactor(a: number, b: number, at: number): void {
  fac[at] = -(zr[a] + zr[b])
  fac[at + 1] = zr[a] * zr[b] - zi[a] * zi[b]
}

/**
 * Ferrari's factorization of the scaled monic quartic into `fac`.
 */
function ferrariFactorization(b: number, c: number, d: number, e: number): void {
  // Depressed quartic y^4 + p y^2 + q y + r, with x = y - h.
  const h = b / 4
  const bb = b * b
  const p = c - (3 / 8) * bb
  const q = d - (b * c) / 2 + (bb * b) / 8
  const r = e - (b * d) / 4 + (bb * c) / 16 - (3 / 256) * bb * bb

  // Resolvent cubic m^3 + p m^2 + (p^2/4 - r) m - q^2/8 = 0. It is negative
  // at m = 0 and grows without bound, so its largest real root is >= 0.
  const m = Math.max(0, largestRealCubicRoot(p, (p * p) / 4 - r, -(q * q) / 8))

  let alpha1: number
  let beta1: number
  let alpha2: number
  let beta2: number

  if (m > 0) {
    // y^4 + p y^2 + q y + r = (y^2 + w y + t1)(y^2 - w y + t2)
    const w = Math.sqrt(2 * m)
    const half = p / 2 + m
    const k = q / (2 * w)
    alpha1 = w
    beta1 = half - k
    alpha2 = -w
    beta2 = half + k
  } else {
    // q = 0: biquadratic y^4 + p y^2 + r.
    const disc = p * p - 4 * r
    if (disc >= 0) {
      // (y^2 - z1)(y^2 - z2) with z1, z2 real.
      const sq = Math.sqrt(disc)
      const z1 = (-p + (p <= 0 ? sq : -sq)) / 2
      const z2 = z1 !== 0 ? r / z1 : (-p - (p <= 0 ? sq : -sq)) / 2
      alpha1 = 0
      beta1 = -z1
      alpha2 = 0
      beta2 = -z2
    } else {
      // Complex z: (y^2 + v y + u)(y^2 - v y + u), u = sqrt(r), v^2 = 2u - p.
      const u = Math.sqrt(r)
      const v = Math.sqrt(Math.max(0, 2 * u - p))
      alpha1 = v
      beta1 = u
      alpha2 = -v
      beta2 = u
    }
  }

  // Undo the shift: y^2 + alpha y + beta with y = x + h.
  fac[0] = alpha1 + 2 * h
  fac[1] = beta1 + h * (h + alpha1)
  fac[2] = alpha2 + 2 * h
  fac[3] = beta2 + h * (h + alpha2)
}

/**
 * Componentwise residual of the factorization equations: each equation's
 * error relative to the magnitude of its own terms. Measuring absolute error
 * instead would let a step trade away all accuracy in tiny coefficients for a
 * small gain in large ones, which loses the small roots.
 */
function factorResidual(
  a1: number,
  b1: number,
  a2: number,
  b2: number,
  b: number,
  c: number,
  d: number,
  e: number,
): number {
  return (
    relErr(a1 + a2 - b, Math.abs(a1) + Math.abs(a2) + Math.abs(b)) +
    relErr(b1 + b2 + a1 * a2 - c, Math.abs(b1) + Math.abs(b2) + Math.abs(a1 * a2) + Math.abs(c)) +
    relErr(a1 * b2 + a2 * b1 - d, Math.abs(a1 * b2) + Math.abs(a2 * b1) + Math.abs(d)) +
    relErr(b1 * b2 - e, Math.abs(b1 * b2) + Math.abs(e))
  )
}

function relErr(err: number, scale: number): number {
  return scale === 0 ? 0 : Math.abs(err) / scale
}

/**
 * Newton's method on F(a1, b1, a2, b2) = 0, where
 *   F1 = a1 + a2 - b
 *   F2 = b1 + b2 + a1 a2 - c
 *   F3 = a1 b2 + a2 b1 - d
 *   F4 = b1 b2 - e
 * Stops when the residual stops decreasing or the Jacobian is singular (which
 * happens when the two factors share a root).
 */
function refineFactorization(b: number, c: number, d: number, e: number): void {
  let a1 = fac[0]
  let b1 = fac[1]
  let a2 = fac[2]
  let b2 = fac[3]
  let err = factorResidual(a1, b1, a2, b2, b, c, d, e)

  for (let it = 0; it < FACTOR_ITERATIONS && err > FACTOR_CONVERGED; it++) {
    // Rows: dF/d(a1, b1, a2, b2) | -F
    jac[0] = 1; jac[1] = 0; jac[2] = 1; jac[3] = 0
    jac[4] = -(a1 + a2 - b)
    jac[5] = a2; jac[6] = 1; jac[7] = a1; jac[8] = 1
    jac[9] = -(b1 + b2 + a1 * a2 - c)
    jac[10] = b2; jac[11] = a2; jac[12] = b1; jac[13] = a1
    jac[14] = -(a1 * b2 + a2 * b1 - d)
    jac[15] = 0; jac[16] = b2; jac[17] = 0; jac[18] = b1
    jac[19] = -(b1 * b2 - e)

    if (!solve4(jac, step)) break

    const na1 = a1 + step[0]
    const nb1 = b1 + step[1]
    const na2 = a2 + step[2]
    const nb2 = b2 + step[3]
    const nerr = factorResidual(na1, nb1, na2, nb2, b, c, d, e)
    if (!(nerr < err)) break

    a1 = na1
    b1 = nb1
    a2 = na2
    b2 = nb2
    err = nerr
  }

  fac[0] = a1
  fac[1] = b1
  fac[2] = a2
  fac[3] = b2
}

/**
 * Gaussian elimination with partial pivoting on a 4x5 augmented matrix
 * (row-major). Writes the solution to `x`. Returns false if singular.
 */
function solve4(m: Float64Array, x: Float64Array): boolean {
  for (let col = 0; col < 4; col++) {
    let pivot = col
    let best = Math.abs(m[col * 5 + col])
    for (let row = col + 1; row < 4; row++) {
      const v = Math.abs(m[row * 5 + col])
      if (v > best) {
        best = v
        pivot = row
      }
    }
    if (best < 1e-300) return false
    if (pivot !== col) {
      for (let j = col; j < 5; j++) {
        const t = m[col * 5 + j]
        m[col * 5 + j] = m[pivot * 5 + j]
        m[pivot * 5 + j] = t
      }
    }
    const inv = 1 / m[col * 5 + col]
    for (let row = col + 1; row < 4; row++) {
      const f = m[row * 5 + col] * inv
      if (f === 0) continue
      for (let j = col; j < 5; j++) m[row * 5 + j] -= f * m[col * 5 + j]
    }
  }
  for (let row = 3; row >= 0; row--) {
    let sum = m[row * 5 + 4]
    for (let j = row + 1; j < 4; j++) sum -= m[row * 5 + j] * x[j]
    x[row] = sum / m[row * 5 + row]
  }
  return Number.isFinite(x[0] + x[1] + x[2] + x[3])
}
