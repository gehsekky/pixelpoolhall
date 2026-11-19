/**
 * Robust fallback for the closed-form solvers: Aberth–Ehrlich simultaneous
 * iteration with starting points from the Newton polygon.
 *
 * Closed-form cubic/quartic formulas lose roots whose magnitudes differ by many
 * orders (the small roots vanish into the rounding error of the large ones).
 * Aberth's method has no such weakness: each root converges cubically from a
 * start on a circle of the right radius, and the Newton polygon (the upper
 * convex hull of log|a_i|) supplies those radii, which separate the roots by
 * magnitude from the start.
 *
 * References (mathematics, no code used):
 *  - O. Aberth, "Iteration methods for finding all zeros of a polynomial
 *    simultaneously", Math. Comp. 27 (1973).
 *  - D. A. Bini, "Numerical computation of polynomial zeros by means of
 *    Aberth's method", Numerical Algorithms 13 (1996) — Newton polygon starts.
 */

const MAX_ITERATIONS = 80

/** Ascending-order magnitudes |a_0| .. |a_n| of the monic polynomial. */
const mag = new Float64Array(5)
const hull = new Int32Array(5)
const done = new Uint8Array(4)

/**
 * Finds all n roots (n <= 4) of the monic polynomial
 *   x^n + c[0] x^(n-1) + ... + c[n-1]
 * and writes them to re/im[0..n). Requires c[n-1] != 0 (no zero root), and
 * coefficients already scaled so they cannot overflow.
 */
export function aberth(c: Float64Array, n: number, re: Float64Array, im: Float64Array): void {
  startingPoints(c, n, re, im)
  done.fill(0)

  for (let it = 0; it < MAX_ITERATIONS; it++) {
    let active = 0
    for (let k = 0; k < n; k++) {
      if (done[k]) continue
      const x = re[k]
      const y = im[k]

      // p(z), p'(z), and the magnitude bound sum |a_i| |z|^i, by Horner.
      let pr = 1
      let pi = 0
      let dr = 0
      let di = 0
      const az = Math.hypot(x, y)
      let bound = 1
      for (let j = 0; j < n; j++) {
        const ndr = dr * x - di * y + pr
        const ndi = dr * y + di * x + pi
        dr = ndr
        di = ndi
        const npr = pr * x - pi * y + c[j]
        const npi = pr * y + pi * x
        pr = npr
        pi = npi
        bound = bound * az + Math.abs(c[j])
      }

      // Stop iterating this root once p(z) is at rounding level.
      const pAbs = Math.hypot(pr, pi)
      if (pAbs <= 4 * Number.EPSILON * bound) {
        done[k] = 1
        continue
      }
      active++

      // Newton correction N = p / p'.
      const den = dr * dr + di * di
      if (den === 0) {
        // Stationary point: nudge off it.
        re[k] = x + 1e-8 * (az || 1)
        im[k] = y + 1e-8 * (az || 1)
        continue
      }
      const nr = (pr * dr + pi * di) / den
      const ni = (pi * dr - pr * di) / den

      // S = sum over j != k of 1 / (z_k - z_j)
      let sr = 0
      let si = 0
      for (let j = 0; j < n; j++) {
        if (j === k) continue
        const ur = x - re[j]
        const ui = y - im[j]
        const ud = ur * ur + ui * ui
        if (ud === 0) continue
        sr += ur / ud
        si -= ui / ud
      }

      // w = N / (1 - N S)
      const qr = 1 - (nr * sr - ni * si)
      const qi = -(nr * si + ni * sr)
      const qd = qr * qr + qi * qi
      let wr: number
      let wi: number
      if (qd === 0) {
        wr = nr
        wi = ni
      } else {
        wr = (nr * qr + ni * qi) / qd
        wi = (ni * qr - nr * qi) / qd
      }

      re[k] = x - wr
      im[k] = y - wi
      if (Math.hypot(wr, wi) <= Number.EPSILON * Math.hypot(re[k], im[k])) done[k] = 1
    }
    if (active === 0) break
  }
}

/**
 * Bini's starting points: for each edge of the Newton polygon spanning
 * m = j - i coefficients, m points on the circle of radius
 * (|a_i| / |a_j|)^(1/m), at angles offset so no two start symmetric about the
 * real axis (which would keep conjugate candidates from separating).
 */
function startingPoints(c: Float64Array, n: number, re: Float64Array, im: Float64Array): void {
  // Ascending order: a_0 = c[n-1], ..., a_{n-1} = c[0], a_n = 1.
  for (let i = 0; i < n; i++) mag[i] = Math.abs(c[n - 1 - i])
  mag[n] = 1

  // Upper convex hull of (i, log|a_i|) over nonzero coefficients.
  let h = 0
  for (let i = 0; i <= n; i++) {
    if (mag[i] === 0) continue
    const yi = Math.log(mag[i])
    while (h >= 2) {
      const i1 = hull[h - 2]
      const i2 = hull[h - 1]
      const y1 = Math.log(mag[i1])
      const y2 = Math.log(mag[i2])
      // Remove i2 if it lies on or below the segment i1 -> i.
      if ((y2 - y1) * (i - i1) <= (yi - y1) * (i2 - i1)) h--
      else break
    }
    hull[h++] = i
  }

  let k = 0
  for (let e = 0; e + 1 < h; e++) {
    const i = hull[e]
    const j = hull[e + 1]
    const m = j - i
    const radius = (mag[i] / mag[j]) ** (1 / m)
    for (let t = 0; t < m; t++) {
      const angle = (2 * Math.PI * t) / m + (2 * Math.PI * e) / n + 0.4
      re[k] = radius * Math.cos(angle)
      im[k] = radius * Math.sin(angle)
      k++
    }
  }
}
