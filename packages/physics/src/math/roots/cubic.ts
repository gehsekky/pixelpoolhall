import { aberth } from "./aberth.ts"
import { backwardError } from "./certify.ts"
import { polishRoot } from "./polish.ts"
import { quadraticInto } from "./quadratic.ts"
import { powerOfTwoAtLeast, type Roots } from "./roots.ts"

/**
 * Cubic solver, written from the classical mathematics (clean-room).
 *
 * Steps (mirroring quartic.ts):
 *  1. Normalize to a monic cubic and scale x = s*y by an exact power of two
 *     so every coefficient is <= 1.
 *  2. Closed form: Cardano for one real root, Viète's trigonometric form for
 *     three.
 *  3. Unless the result is already exact to ~2 eps: regroup the roots into
 *     a real factorization (x - r)(x^2 + alpha x + beta), refine it with
 *     Newton's method, re-solve, and apply guarded Newton polishing (kept only
 *     if the root set's backward error does not get worse).
 *  4. Certify by componentwise backward error. If the check fails (roots of
 *     very different magnitudes, or close pairs), recompute with Aberth's
 *     method, regroup into a real factorization (x - r)(x^2 + alpha x + beta),
 *     refine it with Newton's method, and keep whichever result is better.
 */

const SQRT3_OVER_2 = Math.sqrt(3) / 2
const TWO_PI_OVER_3 = (2 * Math.PI) / 3

const POLISH_ITERATIONS = 2
const POLISH_SKIP = 2
const CERTIFY_TOLERANCE = 4
const FACTOR_ITERATIONS = 8
const FACTOR_CONVERGED = 2 * Number.EPSILON

/** Monic coefficients [B, C, D] of the scaled cubic. */
const coef = new Float64Array(3)
const zr = new Float64Array(3)
const zi = new Float64Array(3)
const keepRe = new Float64Array(3)
const keepIm = new Float64Array(3)
const polishRe = new Float64Array(3)
const polishIm = new Float64Array(3)
/** Factorization (r, alpha, beta) of (x - r)(x^2 + alpha x + beta). */
const fac = new Float64Array(3)
const jac = new Float64Array(12)
const step = new Float64Array(3)

/** Counters for tests and benchmarks: how often the fallback path runs. */
export const cubicStats = { calls: 0, fallbacks: 0 }

/**
 * Solves a*x^3 + b*x^2 + c*x + d = 0 into `out`. Returns the number of roots.
 * Leading zeros drop to the quadratic or linear case.
 */
export function solveCubic(a: number, b: number, c: number, d: number, out: Roots): number {
  out.count = cubicInto(a, b, c, d, out, 0)
  return out.count
}

/**
 * Writes the roots of a*x^3 + b*x^2 + c*x + d into `out` starting at
 * `offset`, without touching `out.count`. Returns the number of roots written.
 */
export function cubicInto(
  a: number,
  b: number,
  c: number,
  d: number,
  out: Roots,
  offset: number,
): number {
  if (a === 0) return quadraticInto(b, c, d, out, offset)

  let B = b / a
  let C = c / a
  let D = d / a

  const re = out.re
  const im = out.im

  if (D === 0) {
    re[offset] = 0
    im[offset] = 0
    return 1 + quadraticInto(1, B, C, out, offset + 1)
  }

  const s = powerOfTwoAtLeast(Math.max(Math.abs(B), Math.sqrt(Math.abs(C)), Math.cbrt(Math.abs(D))))
  B /= s
  C /= s * s
  D /= s * s * s
  coef[0] = B
  coef[1] = C
  coef[2] = D
  cubicStats.calls++

  closedForm(B, C, D, out, offset)
  let err = backwardError(coef, 3, re, im, offset)

  if (err > POLISH_SKIP) {
    // Refine the closed-form roots as a factorization, as the quartic does.
    for (let k = 0; k < 3; k++) {
      zr[k] = re[offset + k]
      zi[k] = im[offset + k]
    }
    err = solveFromFactors(out, offset, err)
  }

  if (err > CERTIFY_TOLERANCE) {
    cubicStats.fallbacks++
    for (let k = 0; k < 3; k++) {
      keepRe[k] = re[offset + k]
      keepIm[k] = im[offset + k]
    }
    aberth(coef, 3, zr, zi)
    const err2 = solveFromFactors(out, offset, Infinity)
    if (!(err2 < err)) {
      for (let k = 0; k < 3; k++) {
        re[offset + k] = keepRe[k]
        im[offset + k] = keepIm[k]
      }
    }
  }

  for (let k = 0; k < 3; k++) {
    re[offset + k] *= s
    im[offset + k] *= s
  }
  return 3
}

/** Cardano / Viète roots of the scaled monic cubic, written to out[offset..]. */
function closedForm(B: number, C: number, D: number, out: Roots, offset: number): void {
  const re = out.re
  const im = out.im

  // Depressed cubic t^3 + p*t + q, with y = t - B/3.
  const shift = B / 3
  const p = C - B * shift
  const q = ((2 * B * B) / 27 - C / 3) * B + D
  const halfQ = q / 2
  const thirdP = p / 3
  const disc = halfQ * halfQ + thirdP * thirdP * thirdP

  if (disc > 0) {
    // One real root and a complex-conjugate pair.
    const u = -Math.sign(halfQ) * Math.cbrt(Math.abs(halfQ) + Math.sqrt(disc))
    const v = u !== 0 ? -thirdP / u : 0
    re[offset] = u + v - shift
    im[offset] = 0
    re[offset + 1] = re[offset + 2] = -(u + v) / 2 - shift
    const imag = SQRT3_OVER_2 * Math.abs(u - v)
    im[offset + 1] = imag
    im[offset + 2] = -imag
  } else if (p === 0) {
    // disc <= 0 with p = 0 forces q = 0: a triple root.
    re[offset] = re[offset + 1] = re[offset + 2] = -shift
    im[offset] = im[offset + 1] = im[offset + 2] = 0
  } else {
    // Three real roots (p < 0 here).
    const r = Math.sqrt(-thirdP)
    const cosArg = Math.max(-1, Math.min(1, -halfQ / (r * r * r)))
    const theta = Math.acos(cosArg) / 3
    for (let k = 0; k < 3; k++) {
      re[offset + k] = 2 * r * Math.cos(theta - TWO_PI_OVER_3 * k) - shift
      im[offset + k] = 0
    }
  }
}

/**
 * From candidate roots in zr/zi: regroup into a real factorization, refine
 * it, solve, polish, and certify. Writes the roots to out[offset..] only if
 * they beat `current` (the backward error of what is there now), and returns
 * the backward error of whatever out[offset..] then holds.
 */
function solveFromFactors(out: Roots, offset: number, current: number): number {
  const re = out.re
  const im = out.im
  for (let k = 0; k < 3; k++) {
    keepRe[k] = re[offset + k]
    keepIm[k] = im[offset + k]
  }
  regroupIntoFactors()
  refineFactorization()
  re[offset] = fac[0]
  im[offset] = 0
  quadraticInto(1, fac[1], fac[2], out, offset + 1)
  const err = polishAndCertify(out, offset)
  if (err < current) return err
  for (let k = 0; k < 3; k++) {
    re[offset + k] = keepRe[k]
    im[offset + k] = keepIm[k]
  }
  return current
}

/**
 * Polishes the three roots at out[offset..] (keeping the result only if the
 * root set's backward error does not grow) and returns that backward error.
 */
function polishAndCertify(out: Roots, offset: number): number {
  const re = out.re
  const im = out.im
  const before = backwardError(coef, 3, re, im, offset)
  if (before <= POLISH_SKIP) return before

  for (let k = 0; k < 3; k++) {
    polishRe[k] = re[offset + k]
    polishIm[k] = im[offset + k]
  }
  for (let k = 0; k < 3; k++) {
    const i = offset + k
    if (im[i] < 0) continue // conjugate of the previous root; mirrored below
    polishRoot(coef, 3, out, i, POLISH_ITERATIONS)
    if (im[i] > 0 && k < 2) {
      re[i + 1] = re[i]
      im[i + 1] = -im[i]
    }
  }
  const after = backwardError(coef, 3, re, im, offset)
  if (after <= before) return after
  for (let k = 0; k < 3; k++) {
    re[offset + k] = polishRe[k]
    im[offset + k] = polishIm[k]
  }
  return before
}

/**
 * From the Aberth roots in zr/zi: the most nearly real root becomes r, and the
 * other two form the real quadratic factor x^2 + alpha x + beta.
 */
function regroupIntoFactors(): void {
  let real = 0
  let best = Infinity
  for (let k = 0; k < 3; k++) {
    const m = Math.sqrt(zr[k] * zr[k] + zi[k] * zi[k])
    const ratio = m > 0 ? Math.abs(zi[k]) / m : 0
    if (ratio < best) {
      best = ratio
      real = k
    }
  }
  const j = real === 0 ? 1 : 0
  const k = real === 2 ? 1 : 2
  fac[0] = zr[real]
  fac[1] = -(zr[j] + zr[k])
  fac[2] = zr[j] * zr[k] - zi[j] * zi[k]
}

function relErr(err: number, scale: number): number {
  return scale === 0 ? 0 : Math.abs(err) / scale
}

/** Componentwise residual of (x - r)(x^2 + alpha x + beta) = x^3 + B x^2 + C x + D. */
function factorResidual(r: number, al: number, be: number): number {
  const B = coef[0]
  const C = coef[1]
  const D = coef[2]
  return (
    relErr(al - r - B, Math.abs(al) + Math.abs(r) + Math.abs(B)) +
    relErr(be - r * al - C, Math.abs(be) + Math.abs(r * al) + Math.abs(C)) +
    relErr(-r * be - D, Math.abs(r * be) + Math.abs(D))
  )
}

/**
 * Newton's method on the factorization equations
 *   F1 = alpha - r - B,  F2 = beta - r alpha - C,  F3 = -r beta - D,
 * kept only while the componentwise residual shrinks.
 */
function refineFactorization(): void {
  let r = fac[0]
  let al = fac[1]
  let be = fac[2]
  let err = factorResidual(r, al, be)
  for (let it = 0; it < FACTOR_ITERATIONS && err > FACTOR_CONVERGED; it++) {
    // Rows: dF/d(r, alpha, beta) | -F
    jac[0] = -1; jac[1] = 1; jac[2] = 0; jac[3] = -(al - r - coef[0])
    jac[4] = -al; jac[5] = -r; jac[6] = 1; jac[7] = -(be - r * al - coef[1])
    jac[8] = -be; jac[9] = 0; jac[10] = -r; jac[11] = -(-r * be - coef[2])
    if (!solve3(jac, step)) break
    const nr = r + step[0]
    const nal = al + step[1]
    const nbe = be + step[2]
    const nerr = factorResidual(nr, nal, nbe)
    if (!(nerr < err)) break
    r = nr
    al = nal
    be = nbe
    err = nerr
  }
  fac[0] = r
  fac[1] = al
  fac[2] = be
}

/** Gaussian elimination with partial pivoting on a 3x4 augmented matrix. */
function solve3(m: Float64Array, x: Float64Array): boolean {
  for (let col = 0; col < 3; col++) {
    let pivot = col
    let best = Math.abs(m[col * 4 + col])
    for (let row = col + 1; row < 3; row++) {
      const v = Math.abs(m[row * 4 + col])
      if (v > best) {
        best = v
        pivot = row
      }
    }
    if (best < 1e-300) return false
    if (pivot !== col) {
      for (let j = col; j < 4; j++) {
        const t = m[col * 4 + j]
        m[col * 4 + j] = m[pivot * 4 + j]
        m[pivot * 4 + j] = t
      }
    }
    const inv = 1 / m[col * 4 + col]
    for (let row = col + 1; row < 3; row++) {
      const f = m[row * 4 + col] * inv
      if (f === 0) continue
      for (let j = col; j < 4; j++) m[row * 4 + j] -= f * m[col * 4 + j]
    }
  }
  for (let row = 2; row >= 0; row--) {
    let sum = m[row * 4 + 3]
    for (let j = row + 1; j < 3; j++) sum -= m[row * 4 + j] * x[j]
    x[row] = sum / m[row * 4 + row]
  }
  return Number.isFinite(x[0] + x[1] + x[2])
}

/**
 * Largest real root of the monic cubic x^3 + B x^2 + C x + D (closed form,
 * then guarded Newton steps on that root only). Used for Ferrari's resolvent,
 * where only this root is needed and the result is refined downstream anyway.
 */
export function largestRealCubicRoot(B: number, C: number, D: number): number {
  const m = Math.max(Math.abs(B), Math.sqrt(Math.abs(C)), Math.cbrt(Math.abs(D)))
  if (m === 0) return 0
  const s = powerOfTwoAtLeast(m)
  const b = B / s
  const c = C / (s * s)
  const d = D / (s * s * s)

  const shift = b / 3
  const p = c - b * shift
  const q = ((2 * b * b) / 27 - c / 3) * b + d
  const halfQ = q / 2
  const thirdP = p / 3
  const disc = halfQ * halfQ + thirdP * thirdP * thirdP

  let x: number
  if (disc > 0) {
    const u = -Math.sign(halfQ) * Math.cbrt(Math.abs(halfQ) + Math.sqrt(disc))
    x = u + (u !== 0 ? -thirdP / u : 0) - shift
  } else if (p === 0) {
    x = -shift
  } else {
    const r = Math.sqrt(-thirdP)
    const cosArg = Math.max(-1, Math.min(1, -halfQ / (r * r * r)))
    // k = 0 gives the largest of the three real roots.
    x = 2 * r * Math.cos(Math.acos(cosArg) / 3) - shift
  }

  // Guarded Newton on f(x) = ((x + b) x + c) x + d.
  let f = ((x + b) * x + c) * x + d
  for (let it = 0; it < 2 && f !== 0; it++) {
    const df = (3 * x + 2 * b) * x + c
    if (df === 0) break
    const nx = x - f / df
    const nf = ((nx + b) * nx + c) * nx + d
    if (!(Math.abs(nf) < Math.abs(f))) break
    x = nx
    f = nf
  }
  return x * s
}
