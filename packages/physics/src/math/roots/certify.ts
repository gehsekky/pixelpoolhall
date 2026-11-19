/**
 * A posteriori accuracy check for a full set of computed roots.
 *
 * Multiplies the roots back out, prod (x - z_k), and compares each resulting
 * coefficient with the input coefficient, relative to the size of the terms
 * that make it up (the same product with every root replaced by |z_k|). This
 * is a componentwise backward error: if it is a small multiple of machine
 * epsilon, the computed roots are the exact roots of a polynomial whose every
 * coefficient is within that relative distance of the input, which is the
 * best any float64 solver can promise.
 *
 * Unlike checking each root separately, this also catches a root being
 * reported twice while another is missed.
 */

/** Complex product coefficients and their magnitude bounds (ascending scratch). */
const pr = new Float64Array(5)
const pi = new Float64Array(5)
const pa = new Float64Array(5)

/**
 * Returns the componentwise backward error, in units of machine epsilon, of
 * roots re/im[offset .. offset+n) for the monic polynomial
 *   x^n + c[0] x^(n-1) + ... + c[n-1].
 */
export function backwardError(
  c: Float64Array,
  n: number,
  re: Float64Array,
  im: Float64Array,
  offset: number,
): number {
  // Coefficients highest-first: index j is the coefficient of x^(n-j).
  pr[0] = 1
  pi[0] = 0
  pa[0] = 1
  for (let j = 1; j <= n; j++) {
    pr[j] = 0
    pi[j] = 0
    pa[j] = 0
  }
  for (let k = 0; k < n; k++) {
    const zr = re[offset + k]
    const zi = im[offset + k]
    const za = Math.sqrt(zr * zr + zi * zi)
    // Multiply by (x - z): new[j] = old[j] - z * old[j-1], from the top down.
    for (let j = k + 1; j >= 1; j--) {
      const ar = pr[j - 1]
      const ai = pi[j - 1]
      pr[j] -= zr * ar - zi * ai
      pi[j] -= zr * ai + zi * ar
      pa[j] += za * pa[j - 1]
    }
  }

  let worst = 0
  for (let j = 1; j <= n; j++) {
    const err = Math.abs(pr[j] - c[j - 1]) + Math.abs(pi[j])
    if (err === 0) continue
    const scale = pa[j]
    if (scale === 0) return Infinity
    const r = err / scale
    if (r > worst) worst = r
  }
  return worst / Number.EPSILON
}
